const CMD_CLIENT_LOG = 0x39;

type ClientLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface ClientLoggerOptions {
  sendToServer: (payload: Uint8Array) => void;
}

export class ClientLogger {
  private seq = 0;
  private encoder = new TextEncoder();
  private sendToServer: (payload: Uint8Array) => void;

  constructor(options: ClientLoggerOptions) {
    this.sendToServer = options.sendToServer;
  }

  debug(msg: string, data?: Record<string, unknown>): void { this.log('debug', msg, data); }
  info(msg: string, data?: Record<string, unknown>): void { this.log('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>): void { this.log('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>): void { this.log('error', msg, data); }

  private log(level: ClientLogLevel, msg: string, data: Record<string, unknown> | undefined): void {
    this.seq++;

    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    const levelTag = level === 'info' ? '' : ` ${level.toUpperCase()}`;
    const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    consoleFn(`[mobitty]${levelTag} ${msg}${dataStr}`);

    const json: Record<string, unknown> = { seq: this.seq, level, msg };
    if (data !== undefined) json['data'] = data;
    const jsonBytes = this.encoder.encode(JSON.stringify(json));
    const payload = new Uint8Array(1 + jsonBytes.length);
    payload[0] = CMD_CLIENT_LOG;
    payload.set(jsonBytes, 1);
    this.sendToServer(payload);
  }
}
