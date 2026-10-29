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
export const EDITOR_OPEN = 0x3b;         // ';' — remote editor: open file for editing: {editId, filePath, content, contentType?}
export const DOWNLOAD_START = 0x3c;      // '<' — file download: {fileName, fileSize, token}
export const FILE_UPLOAD_ACK = 0x3d;     // '=' — file upload ACK: {requestId, status, savedName|errorJson}
export const CLIPBOARD_WRITE = 0x3e;     // '>' — TUI clipboard write (OSC 52 relay): [status:1][text:utf8]
export const VIEWER_OPEN = 0x3f;         // '?' — file viewer: {viewId, root, isDir, entries, truncated, initial?}
export const VIEWER_FILE = 0x40;         // '@' — file viewer: {viewId, path, kind, size, mtimeMs, content?, contentType?, error?}
export const VIEWER_CLOSE = 0x41;        // 'A' — file viewer: closed server-side (CLI gone, superseded): {viewId}
export const VIEWER_NOTICE = 0x42;       // 'B' — file viewer: user-facing message: {viewId, message}
export const VIEWER_SYNC = 0x43;         // 'C' — file viewer: after attach replay, the session's open views: {viewIds}

// Client -> Server
export const INPUT = 0x30;             // '0'
export const RESIZE_TERMINAL = 0x31;   // '1'
export const UPDATE_SETTINGS = 0x32;   // '2' — live settings update: {scrollback?}
export const CLIPBOARD_IMAGE = 0x36;  // '6' — clipboard image upload: {requestId, mime, data}
export const CLIENT_LOG = 0x39;       // '9' — client log forwarding: {seq, level, msg, data?}
export const EDITOR_DONE = 0x3a;      // ':' — remote editor: done editing: {editId?, content, cancelled}
export const EDITOR_ACK = 0x3b;       // ';' — remote editor: panel is on screen: {editId}
export const FILE_UPLOAD = 0x3d;      // '=' — generic file upload: {requestId, filenameLen u16, filename, data}
export const VIEWER_REQUEST = 0x3f;   // '?' — file viewer: {viewId, action: 'read'|'edit', path}
export const VIEWER_DONE = 0x40;      // '@' — file viewer: closed by the user: {viewId}
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

/** A plain JSON object: not `null`, not an array. Lets parsed input be read
 *  field by field, each field still `unknown` until checked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && VALID_LOG_LEVELS.has(value);
}

export function isClientLogMessage(obj: unknown): obj is ClientLogMessage {
  if (!isRecord(obj)) return false;
  return typeof obj['seq'] === 'number'
    && isLogLevel(obj['level'])
    && typeof obj['msg'] === 'string';
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
  /** Scrollback lines the session's terminal keeps. */
  scrollback: number;
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
  /** Set once the child process has been reaped. Gates the SIGKILL escalation. */
  exited: boolean;
  /** Set once `killPty` has run, so a second call never re-kills the pty. */
  killed: boolean;
  /** Pending SIGKILL escalation armed by `killPty`, cleared on exit. */
  killTimer: NodeJS.Timeout | null;
}

export interface ClientState {
  columns: number;
  rows: number;
}

export interface ResizeMessage {
  columns: number;
  rows: number;
}

/** What a view shows, as the server classifies it before sending VIEWER_OPEN.
 *  `large-text` is text over MAX_VIEW_TEXT_BYTES (viewer.ts). */
export type ViewKind = 'folder' | 'image' | 'audio' | 'binary' | 'text' | 'large-text';

export const VIEW_KINDS: readonly ViewKind[] = ['folder', 'image', 'audio', 'binary', 'text', 'large-text'];

/** Features a client declares in its handshake. They describe features,
 *  never a client kind: the server does not tell clients apart. */
export interface ClientCapabilities {
  /** View kinds the client can show. Other views stay queued for a client
   *  that can. */
  viewer: ViewKind[];
  /** Receives DOWNLOAD_START. */
  download: boolean;
  /** Shows an image EDITOR_OPEN. */
  imageEdit: boolean;
  /** Wants SESSION_ALERT / SESSION_NOTIFICATION for its own session too. */
  sessionAlerts: boolean;
}

/** A handshake without `capabilities`, or a field left out of it, means what
 *  the web client has always done. */
export const DEFAULT_CAPABILITIES: Readonly<ClientCapabilities> = {
  viewer: [...VIEW_KINDS],
  download: true,
  imageEdit: true,
  sessionAlerts: false,
};

/** `capabilities` as sent: every field optional. */
export interface CapabilitiesMessage {
  viewer?: string[];
  download?: boolean;
  imageEdit?: boolean;
  sessionAlerts?: boolean;
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
  capabilities?: CapabilitiesMessage;
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
  if (!isRecord(obj)) return false;
  const columns = obj['columns'];
  const rows = obj['rows'];
  return typeof columns === 'number' && Number.isInteger(columns)
    && columns >= 1 && columns <= 800
    && typeof rows === 'number' && Number.isInteger(rows)
    && rows >= 1 && rows <= 400;
}

// Heartbeat configuration
export const HEARTBEAT_INTERVAL_MS = 5000;   // ping every 5s
export const HEARTBEAT_TIMEOUT_MS = 15000;    // dead after 15s with no pong

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

export function isCapabilitiesMessage(obj: unknown): obj is CapabilitiesMessage {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const viewer = 'viewer' in obj ? obj.viewer : undefined;
  const download = 'download' in obj ? obj.download : undefined;
  const imageEdit = 'imageEdit' in obj ? obj.imageEdit : undefined;
  const sessionAlerts = 'sessionAlerts' in obj ? obj.sessionAlerts : undefined;
  return (viewer === undefined || isStringArray(viewer))
    && isOptionalBoolean(download) && isOptionalBoolean(imageEdit) && isOptionalBoolean(sessionAlerts);
}

function isViewKind(value: string): value is ViewKind {
  return VIEW_KINDS.some(k => k === value);
}

/** Fill in what a client left out. View kinds this server does not know are
 *  dropped, so a newer client still attaches. */
export function resolveCapabilities(msg: CapabilitiesMessage | undefined): ClientCapabilities {
  return {
    viewer: msg?.viewer !== undefined ? msg.viewer.filter(isViewKind) : [...DEFAULT_CAPABILITIES.viewer],
    download: msg?.download ?? DEFAULT_CAPABILITIES.download,
    imageEdit: msg?.imageEdit ?? DEFAULT_CAPABILITIES.imageEdit,
    sessionAlerts: msg?.sessionAlerts ?? DEFAULT_CAPABILITIES.sessionAlerts,
  };
}

/** Unknown fields are accepted, so an older server ignores newer ones. Known
 *  fields that are present must have the right type. */
export function isHandshakeMessage(obj: unknown): obj is HandshakeMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  if ('capabilities' in obj && obj.capabilities !== undefined && !isCapabilitiesMessage(obj.capabilities)) return false;
  return true;
}

export function isUpdateSettingsMessage(obj: unknown): obj is UpdateSettingsMessage {
  if (!isRecord(obj)) return false;
  const r = obj;
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
