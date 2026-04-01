import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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
}

function shouldLog(threshold: LogLevel, level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[threshold];
}

function formatConsole(prefix: string, level: LogLevel, msg: string, data: Record<string, unknown> | undefined): string {
  const levelTag = level === 'info' ? '' : ` ${level.toUpperCase()}`;
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  return `${prefix}${levelTag} ${msg}${dataStr}`;
}

function appendEntry(filePath: string | null, entry: LogEntry): void {
  if (filePath === null) return;
  try {
    appendFileSync(filePath, JSON.stringify(entry) + '\n');
  } catch {
    // Silently ignore write failures
  }
}

export class SessionLogger implements LoggerInterface {
  private seq = 0;
  private filePath: string | null;
  private consoleLevel: LogLevel;
  private fileLevel: LogLevel;
  private prefix: string;
  private sessionId: string;

  constructor(sessionId: string, logsDir: string, consoleLevel: LogLevel, fileLevel: LogLevel) {
    this.sessionId = sessionId;
    this.consoleLevel = consoleLevel;
    this.fileLevel = fileLevel;
    this.prefix = `[mobitty:${sessionId.slice(0, 8)}]`;
    this.filePath = join(logsDir, `${sessionId}.jsonl`);
  }

  debug(msg: string, data?: Record<string, unknown>): void { this.log('debug', msg, data); }
  info(msg: string, data?: Record<string, unknown>): void { this.log('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>): void { this.log('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>): void { this.log('error', msg, data); }

  clientLog(level: LogLevel, msg: string, clientSeq: number, data?: Record<string, unknown>): void {
    this.seq++;
    const entry: LogEntry = {
      seq: this.seq,
      ts: new Date().toISOString(),
      level,
      source: 'client',
      session: this.sessionId,
      msg,
      clientSeq,
    };
    if (data !== undefined) entry.data = data;

    if (shouldLog(this.consoleLevel, level)) {
      console.log(formatConsole(this.prefix, level, `[client] ${msg}`, data));
    }
    if (shouldLog(this.fileLevel, level)) {
      appendEntry(this.filePath, entry);
    }
  }

  close(): void {
    this.filePath = null;
  }

  private log(level: LogLevel, msg: string, data: Record<string, unknown> | undefined): void {
    this.seq++;
    const entry: LogEntry = {
      seq: this.seq,
      ts: new Date().toISOString(),
      level,
      source: 'server',
      session: this.sessionId,
      msg,
    };
    if (data !== undefined) entry.data = data;

    if (shouldLog(this.consoleLevel, level)) {
      console.log(formatConsole(this.prefix, level, msg, data));
    }
    if (shouldLog(this.fileLevel, level)) {
      appendEntry(this.filePath, entry);
    }
  }
}

export class Logger implements LoggerInterface {
  private seq = 0;
  private filePath: string | null = null;
  private logsDir: string;
  private config: LoggerConfig;

  constructor(config: LoggerConfig) {
    this.config = config;
    this.logsDir = join(config.dataFolder, 'logs');

    try {
      mkdirSync(this.logsDir, { recursive: true });
      this.filePath = join(this.logsDir, 'server.jsonl');
    } catch {
      console.warn('[mobitty] WARNING: failed to create logs directory, file logging disabled');
    }
  }

  debug(msg: string, data?: Record<string, unknown>): void { this.log('debug', msg, data); }
  info(msg: string, data?: Record<string, unknown>): void { this.log('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>): void { this.log('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>): void { this.log('error', msg, data); }

  createSessionLogger(sessionId: string): SessionLogger {
    return new SessionLogger(sessionId, this.logsDir, this.config.consoleLevel, this.config.fileLevel);
  }

  close(): void {
    this.filePath = null;
  }

  private log(level: LogLevel, msg: string, data: Record<string, unknown> | undefined): void {
    this.seq++;
    const entry: LogEntry = {
      seq: this.seq,
      ts: new Date().toISOString(),
      level,
      source: 'server' as LogSource,
      msg,
    };
    if (data !== undefined) entry.data = data;

    if (shouldLog(this.config.consoleLevel, level)) {
      console.log(formatConsole('[mobitty]', level, msg, data));
    }
    if (shouldLog(this.config.fileLevel, level)) {
      appendEntry(this.filePath, entry);
    }
  }
}

export function createLogger(consoleLevel: LogLevel, fileLevel: LogLevel, dataFolder?: string): Logger {
  const resolvedFolder = dataFolder ?? join(homedir(), '.mobitty');
  return new Logger({ consoleLevel, fileLevel, dataFolder: resolvedFolder });
}
