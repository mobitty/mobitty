const CMD_CLIENT_LOG = 0x39;
const FLUSH_INTERVAL_MS = 5000;
const STORAGE_KEY = 'mobitty-log-buffer';
const MAX_BUFFER_SIZE = 200;

type ClientLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface ClientLogEntry {
  seq: number;
  level: ClientLogLevel;
  msg: string;
  ts: string;
  data?: Record<string, unknown>;
}

interface ClientLoggerOptions {
  sendToServer: (payload: Uint8Array) => void;
  flushIntervalMs?: number;
}

export class ClientLogger {
  private seq = 0;
  private connected = false;
  private session: string | null = null;
  private buffer: ClientLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushIntervalMs: number;
  private encoder = new TextEncoder();
  private sendToServer: (payload: Uint8Array) => void;
  private visibilityCleanup: (() => void) | null = null;

  constructor(options: ClientLoggerOptions) {
    this.sendToServer = options.sendToServer;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;

    const onVisibilityChange = () => {
      if (document.hidden) {
        this.cancelFlush();
      } else if (this.connected && this.buffer.length > 0) {
        this.flush();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    this.visibilityCleanup = () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  dispose(): void {
    this.cancelFlush();
    this.visibilityCleanup?.();
    this.visibilityCleanup = null;
  }

  /** Mark the connection as established. Restores sessionStorage buffer and starts flushing. */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (connected) {
      this.restoreFromStorage();
      this.scheduleFlush();
    } else {
      this.cancelFlush();
      this.persistToStorage();
    }
  }

  /** Update the session context. Flushes current buffer before switching. */
  setSession(session: string | null): void {
    if (this.session !== session && this.buffer.length > 0) {
      if (this.connected) {
        this.flush();
      }
    }
    this.session = session;
  }

  debug(msg: string, data?: Record<string, unknown>): void { this.log('debug', msg, data); }
  info(msg: string, data?: Record<string, unknown>): void { this.log('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>): void { this.log('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>): void { this.log('error', msg, data); }

  private get prefix(): string {
    return this.session ? `[mobitty:${this.session.slice(0, 8)}]` : '[mobitty]';
  }

  private log(level: ClientLogLevel, msg: string, data: Record<string, unknown> | undefined): void {
    this.seq++;

    // Always log to browser console
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    const levelTag = level === 'info' ? '' : ` ${level.toUpperCase()}`;
    const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    consoleFn(`${this.prefix}${levelTag} ${msg}${dataStr}`);

    // Add to buffer
    const entry: ClientLogEntry = { seq: this.seq, level, msg, ts: new Date().toISOString() };
    if (data !== undefined) entry.data = data;
    this.buffer.push(entry);

    if (this.connected) {
      this.scheduleFlush();
    } else {
      this.persistToStorage();
    }
  }

  private scheduleFlush(): void {
    if (document.hidden) return;
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushIntervalMs);
  }

  private cancelFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private flush(): void {
    this.cancelFlush();
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];

    // Build array payload: [0x39][JSON array]
    const jsonBytes = this.encoder.encode(JSON.stringify(batch));
    const payload = new Uint8Array(1 + jsonBytes.length);
    payload[0] = CMD_CLIENT_LOG;
    payload.set(jsonBytes, 1);
    this.sendToServer(payload);

    this.clearStorage();
  }

  private persistToStorage(): void {
    try {
      // Trim to cap before persisting
      while (this.buffer.length > MAX_BUFFER_SIZE) this.buffer.shift();
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.buffer));
    } catch {
      // sessionStorage unavailable or full
    }
  }

  private restoreFromStorage(): void {
    // If the buffer already has entries, we're in the same page session —
    // the in-memory buffer is the truth.  Only restore from sessionStorage
    // after a page reload when the buffer was lost.
    if (this.buffer.length > 0) return;
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const entries: unknown = JSON.parse(stored);
      if (!Array.isArray(entries)) return;
      for (const e of entries) {
        if (isStoredEntry(e)) this.buffer.push(e);
      }
      while (this.buffer.length > MAX_BUFFER_SIZE) this.buffer.shift();
    } catch {
      // sessionStorage unavailable or corrupted
    }
  }

  private clearStorage(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // sessionStorage unavailable
    }
  }
}

function isStoredEntry(obj: unknown): obj is ClientLogEntry {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return typeof r['seq'] === 'number'
    && typeof r['level'] === 'string'
    && typeof r['msg'] === 'string'
    && typeof r['ts'] === 'string';
}
