import type { IPty } from 'node-pty';
import { isAbsolute } from 'node:path';

// Protocol command bytes
// Server -> Client
export const SET_WINDOW_TITLE = 0x31;  // '1'
export const SET_PREFERENCES = 0x32;   // '2'
export const SET_SESSION_INFO = 0x33;     // '3' — session metadata JSON
export const STATE_UPDATE = 0x34;      // '4' — incremental VT diff
export const STATE_FULL = 0x35;        // '5' — full state (reconnect, init, resize, buffer switch)
export const CLIPBOARD_IMAGE_ACK = 0x36; // '6' — clipboard image ACK: {requestId, status}
export const RTT_REPORT = 0x37;          // '7' — RTT in ms (uint16 BE)
export const SESSION_ALERT = 0x38;       // '8' — session alert: sessionId string
export const SESSION_NOTIFICATION = 0x3a; // ':' — rich notification: {sessionId, title, body}
export const EDITOR_OPEN = 0x3b;         // ';' — remote editor: open file for editing
export const DOWNLOAD_START = 0x3c;      // '<' — file download: {fileName, fileSize, token}
export const FILE_UPLOAD_ACK = 0x3d;     // '=' — file upload ACK: {requestId, status, savedName|errorJson}
export const CLIPBOARD_WRITE = 0x3e;     // '>' — TUI clipboard write (OSC 52 relay): [status:1][text:utf8]

// Client -> Server
export const INPUT = 0x30;             // '0'
export const RESIZE_TERMINAL = 0x31;   // '1'
export const UPDATE_SETTINGS = 0x32;   // '2' — live settings update: {scrollback?}
export const CLIPBOARD_IMAGE = 0x36;  // '6' — clipboard image upload: {requestId, mime, data}
export const CLIENT_LOG = 0x39;       // '9' — client log forwarding: {seq, level, msg, data?}
export const EDITOR_DONE = 0x3a;      // ':' — remote editor: done editing
export const FILE_UPLOAD = 0x3d;      // '=' — generic file upload: {requestId, filenameLen u16, filename, data}
export const JSON_DATA = 0x7b;        // '{'

// Logging types
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'server' | 'client';

export interface LogEntry {
  seq: number;
  ts: string;
  level: LogLevel;
  source: LogSource;
  session?: string;
  msg: string;
  data?: Record<string, unknown>;
  clientSeq?: number;
}

export interface ClientLogMessage {
  seq: number;
  level: LogLevel;
  msg: string;
  data?: Record<string, unknown>;
  ts?: string;
}

export interface LoggerInterface {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  isEnabled(level: LogLevel): boolean;
}

const VALID_LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && VALID_LOG_LEVELS.has(value);
}

export function isClientLogMessage(obj: unknown): obj is ClientLogMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  return typeof record['seq'] === 'number'
    && typeof record['level'] === 'string'
    && VALID_LOG_LEVELS.has(record['level'] as string)
    && typeof record['msg'] === 'string';
}

export function isClientLogBatch(obj: unknown): obj is ClientLogMessage[] {
  if (!Array.isArray(obj)) return false;
  for (const item of obj) {
    if (!isClientLogMessage(item)) return false;
  }
  return true;
}

export interface TlsConfig {
  cert: string;
  key: string;
  ca?: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  terminalType: string;
  prefsJson: string;
  dataFolder: string;
  startDir: string;
  maxPayloadBytes: number;
  maxConnections: number;
  maxSessions: number;
  tls?: TlsConfig;
}

export interface SessionInfo {
  sessionId: string;
  name: string;
  pid: number;
  alive: boolean;
  createdAt: string;
  command: string;
  shell: string;
  title: string;
  hasAlert: boolean;
  cwd: string;
}

export interface ServerState {
  clientCount: number;
  config: ServerConfig;
}

export interface PtyHandle {
  pid: number;
  pty: IPty;
  paused: boolean;
  columns: number;
  rows: number;
}

export interface ClientState {
  columns: number;
  rows: number;
}

export interface ResizeMessage {
  columns: number;
  rows: number;
}

export interface HandshakeMessage {
  columns?: number;
  rows?: number;
  sessionId?: string;
  scrollback?: number;
  shell?: string;
  imagePasteDir?: string;
  notificationMode?: string;
  remoteEditor?: boolean;
  themeForeground?: string;
  themeBackground?: string;
}

export interface UpdateSettingsMessage {
  scrollback?: number;
  imagePasteDir?: string;
  notificationMode?: string;
  remoteEditor?: boolean;
  themeForeground?: string;
  themeBackground?: string;
}

export interface EditorResult {
  content: string;
  cancelled: boolean;
}

export function isResizeMessage(obj: unknown): obj is ResizeMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  return typeof record['columns'] === 'number' && Number.isInteger(record['columns'])
    && record['columns'] >= 1 && record['columns'] <= 800
    && typeof record['rows'] === 'number' && Number.isInteger(record['rows'])
    && record['rows'] >= 1 && record['rows'] <= 400;
}

// Heartbeat configuration
export const HEARTBEAT_INTERVAL_MS = 5000;   // ping every 5s
export const HEARTBEAT_TIMEOUT_MS = 15000;    // dead after 15s with no pong

export function isHandshakeMessage(obj: unknown): obj is HandshakeMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  return true;
}

export function isUpdateSettingsMessage(obj: unknown): obj is UpdateSettingsMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (r['scrollback'] !== undefined) {
    if (typeof r['scrollback'] !== 'number' || !Number.isInteger(r['scrollback'])
        || r['scrollback'] < 100 || r['scrollback'] > 50000) return false;
  }
  if (r['imagePasteDir'] !== undefined) {
    if (typeof r['imagePasteDir'] !== 'string' || r['imagePasteDir'].length > 256
        || isAbsolute(r['imagePasteDir'])) return false;
  }
  if (r['notificationMode'] !== undefined) {
    if (typeof r['notificationMode'] !== 'string'
        || !['iterm', 'kitty', 'ghostty', 'off'].includes(r['notificationMode'])) return false;
  }
  if (r['remoteEditor'] !== undefined) {
    if (typeof r['remoteEditor'] !== 'boolean') return false;
  }
  const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
  if (r['themeForeground'] !== undefined) {
    if (typeof r['themeForeground'] !== 'string' || !HEX_COLOR.test(r['themeForeground'])) return false;
  }
  if (r['themeBackground'] !== undefined) {
    if (typeof r['themeBackground'] !== 'string' || !HEX_COLOR.test(r['themeBackground'])) return false;
  }
  return true;
}
