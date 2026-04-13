import { appendFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogLevel, LogSource, LogEntry, LoggerInterface } from './types.ts';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerConfig {
  consoleLevel: LogLevel;
  fileLevel: LogLevel;
  dataFolder: string;
  rotationMs: number;
  retentionMs: number;
}

function shouldLog(threshold: LogLevel, level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[threshold];
}

function formatConsole(prefix: string, level: LogLevel, msg: string, data: Record<string, unknown> | undefined): string {
  const levelTag = level === 'info' ? '' : ` ${level.toUpperCase()}`;
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  return `${prefix}${levelTag} ${msg}${dataStr}`;
}

/** Generates a rotation-aligned filename like `2026-04-12T00-00.jsonl`. */
function rotationFileName(nowMs: number, rotationMs: number): string {
  const epoch = Math.floor(nowMs / rotationMs) * rotationMs;
  const d = new Date(epoch);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}-${pad2(d.getUTCMinutes())}.jsonl`;
}

// ── LogWriter ───────────────────────────────────────────────────────────────

export class LogWriter {
  seq = 0;
  private filePath: string | null = null;
  private currentFile = '';
  private closed = false;
  private logsDir: string;
  private rotationMs: number;
  private retentionMs: number;

  constructor(logsDir: string, rotationMs: number, retentionMs: number) {
    this.logsDir = logsDir;
    this.rotationMs = rotationMs;
    this.retentionMs = retentionMs;

    try {
      mkdirSync(logsDir, { recursive: true });
    } catch {
      console.warn('[mobitty] WARNING: failed to create logs directory, file logging disabled');
      return;
    }

    this.rotate(Date.now());
    this.cleanup();
  }

  append(entry: LogEntry): void {
    if (this.closed) return;
    this.rotate(Date.now());
    if (this.filePath === null) return;
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n');
    } catch {
      // Silently ignore write failures
    }
  }

  close(): void {
    this.closed = true;
    this.filePath = null;
  }

  private rotate(nowMs: number): void {
    const name = rotationFileName(nowMs, this.rotationMs);
    if (name === this.currentFile) return;
    this.currentFile = name;
    this.filePath = join(this.logsDir, name);
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    try {
      for (const name of readdirSync(this.logsDir)) {
        if (!name.endsWith('.jsonl')) continue;
        const fullPath = join(this.logsDir, name);
        try {
          const stat = statSync(fullPath);
          if (stat.mtimeMs < cutoff) unlinkSync(fullPath);
        } catch {
          // Ignore individual file errors
        }
      }
    } catch {
      // Ignore readdir errors
    }
  }
}

// ── Logger ──────────────────────────────────────────────────────────────────

export class Logger implements LoggerInterface {
  private writer: LogWriter;
  private consoleLevel: LogLevel;
  private fileLevel: LogLevel;
  private context: Record<string, unknown>;

  constructor(writer: LogWriter, consoleLevel: LogLevel, fileLevel: LogLevel, context?: Record<string, unknown>) {
    this.writer = writer;
    this.consoleLevel = consoleLevel;
    this.fileLevel = fileLevel;
    this.context = context ?? {};
  }

  /** Create a child logger that shares the same LogWriter with additional context. */
  child(context: Record<string, unknown>): Logger {
    return new Logger(this.writer, this.consoleLevel, this.fileLevel, { ...this.context, ...context });
  }

  /** Update a context key on this logger instance (e.g., set session after handshake). */
  set(key: string, value: unknown): void {
    this.context[key] = value;
  }

  debug(msg: string, data?: Record<string, unknown>): void { this.write('debug', 'server', msg, data); }
  info(msg: string, data?: Record<string, unknown>): void { this.write('info', 'server', msg, data); }
  warn(msg: string, data?: Record<string, unknown>): void { this.write('warn', 'server', msg, data); }
  error(msg: string, data?: Record<string, unknown>): void { this.write('error', 'server', msg, data); }

  /** Write a client-sourced log entry (from CLIENT_LOG messages). */
  clientLog(level: LogLevel, msg: string, clientSeq: number, data?: Record<string, unknown>, ts?: string): void {
    this.write(level, 'client', msg, data, clientSeq, ts);
  }

  /** Shut down the underlying LogWriter. Only call on the root logger at shutdown. */
  close(): void {
    this.writer.close();
  }

  private get prefix(): string {
    const session = this.context['session'];
    return typeof session === 'string' ? `[mobitty:${session.slice(0, 8)}]` : '[mobitty]';
  }

  private write(level: LogLevel, source: LogSource, msg: string, explicitData?: Record<string, unknown>, clientSeq?: number, ts?: string): void {
    // Merge context into data, excluding 'session' (promoted to top-level)
    const merged: Record<string, unknown> = {};
    let hasData = false;
    for (const key of Object.keys(this.context)) {
      if (key !== 'session') {
        merged[key] = this.context[key];
        hasData = true;
      }
    }
    if (explicitData !== undefined) {
      for (const key of Object.keys(explicitData)) {
        merged[key] = explicitData[key];
        hasData = true;
      }
    }

    const consoleData = hasData ? merged : undefined;
    const consoleMsg = source === 'client' ? `[client] ${msg}` : msg;

    if (shouldLog(this.consoleLevel, level)) {
      console.log(formatConsole(this.prefix, level, consoleMsg, consoleData));
    }

    if (shouldLog(this.fileLevel, level)) {
      this.writer.seq++;
      const entry: LogEntry = {
        seq: this.writer.seq,
        ts: ts ?? new Date().toISOString(),
        level,
        source,
        msg,
      };

      const session = this.context['session'];
      if (typeof session === 'string') entry.session = session;
      if (hasData) entry.data = merged;
      if (clientSeq !== undefined) entry.clientSeq = clientSeq;

      this.writer.append(entry);
    }
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createLogger(config: LoggerConfig): Logger {
  const logsDir = join(config.dataFolder, 'logs');
  const writer = new LogWriter(logsDir, config.rotationMs, config.retentionMs);
  return new Logger(writer, config.consoleLevel, config.fileLevel);
}
