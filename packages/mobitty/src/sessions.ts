import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { release, homedir } from 'node:os';
import type { PtyHandle, SessionInfo, EditorResult, ClientCapabilities, ViewKind } from './types.ts';
import { DEFAULT_CAPABILITIES, VIEWER_CLOSE, VIEWER_NOTICE, VIEWER_OPEN, VIEWER_SYNC } from './types.ts';
import type { ViewEntry } from './viewer.ts';
import { spawnPty, writePty, resizePty, killPty } from './pty.ts';
import { generateUniqueSessionName } from './session-names.ts';
import type { LoggerInterface } from './types.ts';
import headlessPkg from '@xterm/headless';
const { Terminal } = headlessPkg;
import { trackCursorVisibility } from './cursor-visibility.ts';
import type { CursorVisibilityTracker } from './cursor-visibility.ts';
import { trackMouseEncoding } from './mouse-encoding.ts';
import type { MouseEncodingTracker } from './mouse-encoding.ts';
import { trackKittyKeyboard } from './kitty-keyboard.ts';
import type { KittyKeyboardTracker } from './kitty-keyboard.ts';
import { registerNotificationHandlers } from './osc-notifications.ts';
import { registerCwdHandler } from './osc-cwd.ts';
import { registerClipboardHandler } from './osc-clipboard.ts';
import { registerColorQueryHandlers } from './osc-color-query.ts';
import type { OscColorQueryTracker, OscColorConfig } from './osc-color-query.ts';
import { BUILTIN_THEMES } from './themes.ts';
import { normalizeSgrColors } from './sgr-normalize.ts';
import { bufferStats, summarizeBytes, sampleBufferLines, sampleAltBuffer, detectLineRepetition } from './diff.ts';
import type { TrackedModes } from './diff.ts';
import { getProcessCwd } from './clipboard.ts';

const HOME = homedir();
/** Lifetime of a cached `getProcessCwd` result. Must comfortably exceed the
 *  cost of the probe itself (macOS `lsof` can take seconds on a busy host),
 *  otherwise every session-list build re-runs it. */
const CWD_FALLBACK_TTL_MS = 30_000;

/** Relays EDITOR_OPEN to the attached client. Returns `false` when the
 *  connection could not take the message (socket no longer open) so
 *  `requestEdit` can fail the CLI fast instead of blocking it on a message
 *  nobody will ever see. */
export type EditorSender = (editId: number, filePath: string, content: string, contentType?: string) => boolean;

/** How long the client has to confirm the editor panel is on screen before the
 *  server re-sends EDITOR_OPEN, and again before it gives up chasing the ack.
 *  A successful send only proves the bytes left the server — see
 *  `todo-bug-remote-editor-hangs-no-panel.md`. */
const EDITOR_ACK_TIMEOUT_MS = 2000;

/** `requestEdit` rejects an image edit with this while the attached client
 *  can't show images. */
export const IMAGE_EDIT_UNSUPPORTED = "the attached client can't show images";

/** The VIEWER_OPEN payload — kept whole so it can be replayed on attach.
 *  See docs/todo-design-file-viewer.md. */
export interface ViewerOpenPayload {
  viewId: number;
  root: string;
  isDir: boolean;
  entries: ViewEntry[];
  truncated: boolean;
  initial?: string;
}

/** Sends one viewer frame (`cmd` + JSON) to the attached client. Returns
 *  `false` when the socket could not take it — same contract as EditorSender. */
export type ViewerSender = (cmd: number, json: string) => boolean;

/** How `requestView` ended: the user closed a view the CLI waited on, or the
 *  view was queued for the next client that can show it — because no client
 *  was attached, the attached one can't show its kind, or the client that had
 *  it open was replaced by one that can't. */
export type ViewOutcome = 'closed' | 'queued';

/** What the server keeps about the connection attached to a session. */
export interface AttachedClient {
  capabilities: ClientCapabilities;
}

/** A view to open: the VIEWER_OPEN payload less its id, plus what it shows.
 *  `kind` stays on the server. */
export interface ViewRequest extends Omit<ViewerOpenPayload, 'viewId'> {
  kind: ViewKind;
}

/** Views a session keeps open or queued. Past this, the oldest queued view is
 *  dropped; views a CLI is waiting on are never dropped. */
export const MAX_VIEWS_PER_SESSION = 16;

interface ViewState {
  open: ViewerOpenPayload;
  kind: ViewKind;
  /** Resolves the waiting CLI; `null` for a queued view nobody waits on. */
  resolve: ((outcome: ViewOutcome) => void) | null;
}

/** Scrollback lines of a new session whose client did not ask for a size. */
export const DEFAULT_SCROLLBACK = 5000;

/** Why a session raised its alert: the terminal rang its bell, or a view was
 *  queued because no client could show it. */
export type AlertReason = 'bell' | 'view';

export type AlertListener = (sessionId: string, reason: AlertReason) => void;

interface SessionEntry {
  sessionId: string;
  name: string;
  pid: number;
  alive: boolean;
  createdAt: string;
  command: string;
  shell: string;
  handle: PtyHandle | null;
  headless: InstanceType<typeof Terminal> | null;
  cursorTracker: CursorVisibilityTracker | null;
  colorTracker: OscColorQueryTracker | null;
  mouseEncodingTracker: MouseEncodingTracker | null;
  kittyKeyboardTracker: KittyKeyboardTracker | null;
  title: string;
  hasAlert: boolean;
  /** Last-known absolute CWD reported via OSC 7. Empty until a shell reports it. */
  reportedCwd: string;
  /** Cached fallback (getProcessCwd) value with expiry, used when no OSC 7 yet. */
  fallbackCwd: { value: string; expiresAt: number } | null;
  /** True while a background getProcessCwd probe is in flight, so a burst of
   *  session-list builds triggers at most one subprocess. */
  fallbackCwdPending: boolean;
  onExitCallbacks: Array<() => void>;
  onDetachCallbacks: Array<() => void>;
  onChangeCallbacks: Array<() => void>;
  editorPending: {
    editId: number;
    filePath: string;
    content: string;
    contentType?: string;
    resolve: (result: EditorResult) => void;
    /** Set when the client reports the panel is actually on screen. */
    acked: boolean;
    ackTimer: NodeJS.Timeout | null;
  } | null;
  editorSender: EditorSender | null;
  /** Open and queued views, oldest first. */
  views: ViewState[];
  viewerSender: ViewerSender | null;
  downloadSender: ((fileName: string, fileSize: number, token: string) => void) | null;
  /** Set by the attached connection; relays OSC 52 clipboard writes to it.
   *  `null` text means the payload blew the size cap — the client surfaces
   *  that rather than dropping the copy silently. */
  clipboardSender: ((text: string | null) => void) | null;
  /** The connection attached now; `null` once it closed. */
  attachedClient: AttachedClient | null;
  scrollCount: number;
}

interface SessionsDiskData {
  sessions: Array<{
    sessionId: string;
    name: string;
    pid: number;
    createdAt: string;
    command: string;
    shell: string;
  }>;
}

export class SessionRegistry {
  private sessions = new Map<string, SessionEntry>();
  private filePath: string;
  private dataFolder: string;
  private logger: LoggerInterface;
  private alertListeners = new Set<AlertListener>();
  private notificationListeners = new Set<(sessionId: string, title: string, body: string) => void>();
  private maxSessions: number;
  private startDir: string;
  /** Monotonic across all sessions, so an edit id is never ambiguous in a log
   *  line or in an EDITOR_ACK / EDITOR_DONE that arrives on the wrong session. */
  private nextEditId = 1;
  /** Monotonic across all sessions, for the same reason as `nextEditId`. */
  private nextViewId = 1;

  constructor(dataFolder: string, logger: LoggerInterface, maxSessions = 0, startDir = '') {
    this.dataFolder = dataFolder;
    this.logger = logger;
    this.filePath = join(dataFolder, 'sessions.json');
    this.maxSessions = maxSessions;
    this.startDir = startDir;
  }

  init(): void {
    mkdirSync(this.dataFolder, { recursive: true });
    this.loadFromDisk();
  }

  aliveSessionCount(): number {
    let count = 0;
    for (const entry of this.sessions.values()) {
      if (entry.alive) count++;
    }
    return count;
  }

  private loadFromDisk(): void {
    let data: SessionsDiskData;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      data = JSON.parse(raw) as SessionsDiskData;
    } catch {
      return;
    }

    if (!Array.isArray(data.sessions)) return;

    for (const s of data.sessions) {
      if (typeof s.sessionId !== 'string') continue;
      let alive = false;
      try {
        process.kill(s.pid, 0);
        // PID exists, but we have no handle — can't reattach
        alive = false;
      } catch {
        alive = false;
      }

      this.sessions.set(s.sessionId, {
        sessionId: s.sessionId,
        name: s.name,
        pid: s.pid,
        alive,
        createdAt: s.createdAt,
        command: s.command,
        shell: s.shell,
        handle: null,
        headless: null,
        cursorTracker: null,
        colorTracker: null,
        mouseEncodingTracker: null,
        kittyKeyboardTracker: null,
        title: '',
        hasAlert: false,
        reportedCwd: '',
        fallbackCwd: null,
        fallbackCwdPending: false,
        onExitCallbacks: [],
        onDetachCallbacks: [],
        onChangeCallbacks: [],
        editorPending: null,
        editorSender: null,
        views: [],
        viewerSender: null,
      attachedClient: null,
        downloadSender: null,
        clipboardSender: null,
        scrollCount: 0,
      });
    }

    this.logger.debug('loaded sessions from disk', { count: this.sessions.size });
  }

  private persist(): void {
    const data: SessionsDiskData = {
      sessions: [...this.sessions.values()].map(s => ({
        sessionId: s.sessionId,
        name: s.name,
        pid: s.pid,
        createdAt: s.createdAt,
        command: s.command,
        shell: s.shell,
      })),
    };
    try {
      writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('failed to persist sessions', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  createSession(
    argv: string[],
    terminalType: string,
    columns: number,
    rows: number,
    scrollback: number,
    shellName: string,
    env?: Record<string, string>,
  ): { info: SessionInfo; handle: PtyHandle } {
    if (this.maxSessions > 0 && this.aliveSessionCount() >= this.maxSessions) {
      throw new Error('Session limit reached');
    }
    const sessionId = randomUUID();
    const existingNames = new Set([...this.sessions.values()].map(s => s.name));
    const name = generateUniqueSessionName(existingNames);

    const windowsPty = process.platform === 'win32'
      ? { backend: 'conpty' as const, buildNumber: parseInt(release().split('.')[2] ?? '0', 10) }
      : undefined;
    const headless = new Terminal({ cols: columns, rows, scrollback, allowProposedApi: true, windowsPty });
    let title = '';

    const onExitCallbacks: Array<() => void> = [];
    const onDetachCallbacks: Array<() => void> = [];
    const onChangeCallbacks: Array<() => void> = [];

    const notifyChange = () => {
      for (const cb of onChangeCallbacks) cb();
    };

    const cursorTracker = trackCursorVisibility(headless, notifyChange);

    // Mouse report encoding isn't on xterm's public `terminal.modes`, so the
    // diff/serialize layer can't read it — track it here and thread it into
    // captureSnapshot/serializeFullState via getTrackedModes(). Without this a
    // TUI's SGR mouse mode (`\x1b[?1006h`, e.g. Copilot CLI) never reaches the
    // client and mouse-move reports arrive as garbled X10 bytes. See
    // docs/done-bug-copilot-mouse-sgr-encoding-not-serialized.md.
    const mouseEncodingTracker = trackMouseEncoding(headless, (encoding) => {
      if (this.logger.isEnabled('debug')) {
        this.logger.debug('mouse-encoding-change', { sessionId, encoding });
      }
      notifyChange();
    });

    // Kitty keyboard protocol (`CSI = | ? | > | < u`). The headless parser
    // would drop an app's `CSI > 5 u` and the client would keep sending `\r`
    // for Ctrl+Enter; track the flags here, answer `CSI ? u` straight to the
    // PTY, and replay the flags to the client as `CSI = N ; 1 u` (diff.ts).
    // Registered before spawnPty so an app's startup probe gets its answer.
    // See docs/todo-bug-ctrl-enter-alt-buffer.md.
    const kittyKeyboardTracker = trackKittyKeyboard(headless, {
      reply: (data) => {
        if (entry.handle) writePty(entry.handle, data);
      },
      onChange: (flags) => {
        if (this.logger.isEnabled('debug')) {
          this.logger.debug('kitty-keyboard-change', { sessionId, flags });
        }
        notifyChange();
      },
    });

    headless.onCursorMove(notifyChange);
    headless.onLineFeed(notifyChange);
    let prevScrollBaseY = 0;
    headless.onScroll(() => {
      const baseY = headless.buffer.active.baseY;
      if (baseY < prevScrollBaseY) {
        // baseY decreased (CSI 3J or resize) — don't count
        prevScrollBaseY = baseY;
      } else {
        entry.scrollCount++;
        prevScrollBaseY = baseY;
      }
      notifyChange();
    });
    headless.onBell(() => {
      this.raiseAlert(entry, 'bell');
      notifyChange();
    });
    headless.onResize(notifyChange);
    headless.buffer.onBufferChange(notifyChange);
    headless.onTitleChange(t => { title = t; entry.title = t; notifyChange(); });
    registerNotificationHandlers(headless, (notifTitle, body) => {
      // Use session terminal title instead of generic "Notification" (e.g. from OSC 9)
      const effectiveTitle = notifTitle === 'Notification' && title ? title : notifTitle;
      entry.hasAlert = true;
      for (const cb of this.notificationListeners) cb(sessionId, effectiveTitle, body);
      notifyChange();
    });
    registerCwdHandler(headless, (cwd) => {
      if (entry.reportedCwd === cwd) return;
      entry.reportedCwd = cwd;
      notifyChange();
    });

    // OSC 52 — a program in the session asks to put text on the *user's*
    // clipboard. Nothing downstream forwards raw PTY bytes to the browser
    // (docs/done-design-ssp.md), so relay the decoded text to whichever client
    // is attached. Sessions with no attached client drop it rather than
    // hijacking the clipboard of a user looking at another session.
    registerClipboardHandler(headless, (text) => {
      if (!entry.clipboardSender) {
        this.logger.debug('osc52-no-client', { sessionId, length: text.length });
        return;
      }
      this.logger.debug('osc52-relay', { sessionId, length: text.length });
      entry.clipboardSender(text);
    }, (reason, payloadLength) => {
      this.logger.debug('osc52-dropped', { sessionId, reason, payloadLength });
      // Over-cap copies are the one drop worth surfacing — the user asked for
      // a copy and would otherwise see nothing happen.
      if (reason === 'too-large') entry.clipboardSender?.(null);
    });

    // OSC 10/11/12 color query handlers — respond with the session's theme
    // colors so programs (e.g. nvim) can detect dark/light background.
    const defaultTheme = BUILTIN_THEMES.get('default-dark')!;
    const oscColorConfig: OscColorConfig = {
      foreground: defaultTheme.colors.foreground,
      background: defaultTheme.colors.background,
      cursor: defaultTheme.colors.cursor,
      writeToPty: (response: string) => {
        if (entry.handle) writePty(entry.handle, response);
      },
    };
    const colorTracker = registerColorQueryHandlers(headless, oscColorConfig);

    const command = argv.join(' ');
    const handle = spawnPty(
      {
        argv,
        terminalType,
        columns,
        rows,
        env: { ...env, MOBITTY_SESSION_ID: sessionId },
        cwd: this.startDir || undefined,
      },
      {
        onData: (data: string) => {
          if (this.logger.isEnabled('debug')) {
            this.logger.debug('pty data', { sessionId, ...summarizeBytes(data) });
          }
          headless.write(normalizeSgrColors(data)); notifyChange();
        },
        onExit: () => {
          this.markExited(sessionId, 'pty exit event');
        },
      },
    );

    const entry: SessionEntry = {
      sessionId,
      name,
      pid: handle.pid,
      alive: true,
      createdAt: new Date().toISOString(),
      command,
      shell: shellName,
      handle,
      headless,
      cursorTracker,
      colorTracker,
      mouseEncodingTracker,
      kittyKeyboardTracker,
      title,
      hasAlert: false,
      reportedCwd: '',
      fallbackCwd: null,
      fallbackCwdPending: false,
      onExitCallbacks,
      onDetachCallbacks,
      onChangeCallbacks,
      editorPending: null,
      editorSender: null,
      views: [],
      viewerSender: null,
      attachedClient: null,
      downloadSender: null,
      clipboardSender: null,
      scrollCount: 0,
    };

    this.sessions.set(sessionId, entry);
    this.persist();
    this.logger.info('session created', { sessionId, name, pid: handle.pid });

    return { info: this.toSessionInfo(entry), handle };
  }

  /** `client` defaults to one with DEFAULT_CAPABILITIES. A client that
   *  can't show images cancels a pending image edit, which would otherwise
   *  hold the session's only edit slot until another client attached. */
  attachSession(
    sessionId: string,
    onExit: () => void,
    onDetach: () => void,
    client: AttachedClient = { capabilities: { ...DEFAULT_CAPABILITIES } },
  ): SessionInfo | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.alive || !entry.handle) return undefined;

    entry.onExitCallbacks.push(onExit);
    entry.onDetachCallbacks.push(onDetach);
    entry.attachedClient = client;
    if (!client.capabilities.imageEdit && entry.editorPending?.contentType?.startsWith('image/')) {
      this.cancelPendingEdit(entry, 'client cannot show images');
    }
    return this.toSessionInfo(entry);
  }

  /** The connection attached to the session, or `null` when none is. */
  getAttachedClient(sessionId: string): AttachedClient | null {
    return this.sessions.get(sessionId)?.attachedClient ?? null;
  }

  /** Clear only if `client` is still the attached one — see clearEditorSender. */
  clearAttachedClient(sessionId: string, client: AttachedClient): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.attachedClient === client) entry.attachedClient = null;
  }

  detachSession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    for (const cb of entry.onDetachCallbacks) cb();
    this.logger.info('session detached', { sessionId });
    entry.onDetachCallbacks.length = 0;
    entry.onExitCallbacks.length = 0;
    entry.onChangeCallbacks.length = 0;
  }

  getHeadless(sessionId: string): InstanceType<typeof Terminal> | null {
    return this.sessions.get(sessionId)?.headless ?? null;
  }

  getTitle(sessionId: string): string {
    return this.sessions.get(sessionId)?.title ?? '';
  }

  getScrollCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.scrollCount ?? 0;
  }

  clearAlert(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.hasAlert = false;
  }

  addAlertListener(cb: AlertListener): () => void {
    this.alertListeners.add(cb);
    return () => { this.alertListeners.delete(cb); };
  }

  addNotificationListener(cb: (sessionId: string, title: string, body: string) => void): () => void {
    this.notificationListeners.add(cb);
    return () => { this.notificationListeners.delete(cb); };
  }

  getCursorHidden(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.cursorTracker?.cursorHidden ?? false;
  }

  /** Modes xterm.js does not expose on `terminal.modes`, for the
   *  diff/serialize layer. */
  getTrackedModes(sessionId: string): TrackedModes {
    const entry = this.sessions.get(sessionId);
    return {
      mouseEncoding: entry?.mouseEncodingTracker?.encoding ?? 'default',
      kittyKeyboardFlags: entry?.kittyKeyboardTracker?.flags ?? 0,
    };
  }

  updateSessionThemeColors(sessionId: string, fg: string, bg: string): void {
    const entry = this.sessions.get(sessionId);
    entry?.colorTracker?.updateColors(fg, bg, fg);
  }

  addChangeListener(sessionId: string, callback: () => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.onChangeCallbacks.push(callback);
  }

  removeChangeListener(sessionId: string, callback: () => void): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const idx = entry.onChangeCallbacks.indexOf(callback);
    if (idx !== -1) entry.onChangeCallbacks.splice(idx, 1);
  }

  getSession(sessionId: string): { info: SessionInfo; handle: PtyHandle | null } | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    return { info: this.toSessionInfo(entry), handle: entry.handle };
  }

  getHandle(sessionId: string): PtyHandle | null {
    return this.sessions.get(sessionId)?.handle ?? null;
  }

  /** The session's absolute cwd for writing files into it: the OSC 7 report
   *  first, else a fresh process probe. '' when neither is available (e.g. a
   *  Windows shell with no OSC 7 hook — getProcessCwd has no win32 probe). */
  async getCwd(sessionId: string): Promise<string> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return '';
    if (entry.reportedCwd) return entry.reportedCwd;
    return getProcessCwd(entry.pid);
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map(e => this.toSessionInfo(e));
  }

  reorderSession(sessionId: string, newIndex: number): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    const entries = [...this.sessions.entries()];
    const currentIndex = entries.findIndex(([id]) => id === sessionId);
    const clamped = Math.max(0, Math.min(entries.length - 1, newIndex));
    if (currentIndex === clamped) return true;
    entries.splice(currentIndex, 1);
    entries.splice(clamped, 0, [sessionId, entry]);
    this.sessions = new Map(entries);
    this.persist();
    return true;
  }

  renameSession(sessionId: string, newName: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(newName)) return false;
    entry.name = newName;
    this.persist();
    return true;
  }

  deleteSession(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    this.cancelPendingEdit(entry);
    this.cancelViews(entry);
    if (entry.alive && entry.handle) {
      killPty(entry.handle);
      entry.alive = false;
    }
    if (entry.cursorTracker) {
      entry.cursorTracker.dispose();
      entry.cursorTracker = null;
    }
    if (entry.colorTracker) {
      entry.colorTracker.dispose();
      entry.colorTracker = null;
    }
    if (entry.mouseEncodingTracker) {
      entry.mouseEncodingTracker.dispose();
      entry.mouseEncodingTracker = null;
    }
    if (entry.kittyKeyboardTracker) {
      entry.kittyKeyboardTracker.dispose();
      entry.kittyKeyboardTracker = null;
    }
    if (entry.headless) {
      entry.headless.dispose();
      entry.headless = null;
    }
    this.sessions.delete(sessionId);
    this.persist();
    this.logger.info('session deleted', { sessionId, name: entry.name });
    return true;
  }

  destroyAll(): void {
    this.logger.info('destroying all sessions', { count: this.sessions.size });
    for (const entry of this.sessions.values()) {
      this.cancelPendingEdit(entry);
      this.cancelViews(entry);
      if (entry.alive && entry.handle) {
        killPty(entry.handle);
        entry.alive = false;
      }
      if (entry.cursorTracker) {
        entry.cursorTracker.dispose();
        entry.cursorTracker = null;
      }
      if (entry.colorTracker) {
        entry.colorTracker.dispose();
        entry.colorTracker = null;
      }
      if (entry.mouseEncodingTracker) {
        entry.mouseEncodingTracker.dispose();
        entry.mouseEncodingTracker = null;
      }
      if (entry.kittyKeyboardTracker) {
        entry.kittyKeyboardTracker.dispose();
        entry.kittyKeyboardTracker = null;
      }
      if (entry.headless) {
        entry.headless.dispose();
        entry.headless = null;
      }
    }
    this.sessions.clear();
    this.persist();
  }

  /** Run a session's exit path once: drop the handle and notify whoever is
   *  attached. Called from node-pty's `exit` event, and from anywhere else
   *  that learns the child is gone before that event arrives. */
  private markExited(sessionId: string, reason: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.alive) return;
    entry.alive = false;
    entry.handle = null;
    this.persist();
    this.logger.info('session process exited', { sessionId, name: entry.name, reason });
    for (const cb of entry.onExitCallbacks) cb();
    entry.onExitCallbacks.length = 0;
  }

  resizeSession(sessionId: string, columns: number, rows: number): void {
    const entry = this.sessions.get(sessionId);
    if (!entry?.handle) return;

    const fromCols = entry.headless?.cols ?? null;
    const fromRows = entry.headless?.rows ?? null;
    const before = entry.headless ? bufferStats(entry.headless) : null;
    const beforeSamples = entry.headless ? sampleBufferLines(entry.headless, 4, 60) : null;
    const beforeAltSamples = entry.headless ? sampleAltBuffer(entry.headless, 4, 60) : null;
    const beforeRepeat = entry.headless ? detectLineRepetition(entry.headless) : null;

    if (!resizePty(entry.handle, columns, rows)) {
      // The pty outlived its child: node-pty had not emitted `exit` yet, so the
      // session still looked alive. This resize is the earliest — sometimes the
      // only — notice we get, so treat it as the exit event.
      this.markExited(sessionId, 'resize on exited pty');
      return;
    }
    if (entry.headless) {
      entry.headless.resize(columns, rows);
    }

    const after = entry.headless ? bufferStats(entry.headless) : null;
    const afterSamples = entry.headless ? sampleBufferLines(entry.headless, 4, 60) : null;
    const afterAltSamples = entry.headless ? sampleAltBuffer(entry.headless, 4, 60) : null;
    const afterRepeat = entry.headless ? detectLineRepetition(entry.headless) : null;

    // afterRepeat.duplicateRows - beforeRepeat.duplicateRows is the
    // per-resize duplication delta — the monitoring signal for the
    // resize-induced scrollback corruption bug
    // (todo-bug-resize-induced-terminal-corruption.md).
    // beforeAltSamples vs afterAltSamples is the signal for the alt-buffer
    // reshape behaviour during a reconnect resize
    // (done-bug-reconnect-alt-buffer-misaligned.md).
    this.logger.info('resize session', {
      sessionId,
      fromCols, fromRows,
      toCols: columns, toRows: rows,
      before, after,
      beforeSamples, afterSamples,
      beforeAltSamples, afterAltSamples,
      beforeRepeat, afterRepeat,
    });
  }

  updateSessionScrollback(sessionId: string, scrollback: number): void {
    const entry = this.sessions.get(sessionId);
    if (!entry?.headless) return;
    entry.headless.options.scrollback = scrollback;
  }

  // ── Remote Editor ──────────────────────────────────────────────────────────

  setEditorSender(sessionId: string, fn: EditorSender): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.editorSender = fn;
  }

  /** Clear only if `fn` is still the registered sender. A disconnecting client
   *  must not wipe callbacks a newer connection already registered for the
   *  same session — its close handler can run after the reconnect's handshake. */
  clearEditorSender(sessionId: string, fn: EditorSender): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.editorSender === fn) entry.editorSender = null;
  }

  getEditorPending(sessionId: string): { editId: number; filePath: string; content: string; contentType?: string } | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry?.editorPending) return undefined;
    const { editId, filePath, content, contentType } = entry.editorPending;
    return contentType ? { editId, filePath, content, contentType } : { editId, filePath, content };
  }

  requestEdit(sessionId: string, filePath: string, content: string, onAbort: (cleanup: () => void) => void, contentType?: string): Promise<EditorResult> {
    const entry = this.sessions.get(sessionId);
    const summary = { sessionId, filePath, bytes: content.length, contentType };
    this.logger.info('editor requested', summary);
    if (!entry) {
      this.logger.warn('editor request rejected', { ...summary, reason: 'session not found' });
      return Promise.reject(new Error('Session not found'));
    }
    if (entry.editorPending) {
      this.logger.warn('editor request rejected', {
        ...summary, reason: 'edit already in progress', pendingFilePath: entry.editorPending.filePath,
      });
      return Promise.reject(new Error('Edit already in progress'));
    }
    if (!entry.editorSender) {
      this.logger.warn('editor request rejected', { ...summary, reason: 'no editor sender registered' });
      return Promise.reject(new Error('No client connected'));
    }
    if (contentType?.startsWith('image/') && entry.attachedClient?.capabilities.imageEdit === false) {
      this.logger.warn('editor request rejected', { ...summary, reason: 'client cannot show images' });
      return Promise.reject(new Error(IMAGE_EDIT_UNSUPPORTED));
    }

    const editId = this.nextEditId++;
    return new Promise<EditorResult>((resolve, reject) => {
      entry.editorPending = { editId, filePath, content, contentType, resolve, acked: false, ackTimer: null };
      const sent = entry.editorSender!(editId, filePath, content, contentType);
      if (!sent) {
        // A registered sender whose socket is no longer writable used to leave
        // the CLI blocked forever on an EDITOR_OPEN nobody received: the client
        // shows no panel, so no EDITOR_DONE is ever sent. Fail fast (503) —
        // $EDITOR reports an error instead of hanging the caller.
        entry.editorPending = null;
        this.logger.warn('editor request rejected', { ...summary, reason: 'send failed' });
        reject(new Error('No client connected'));
        return;
      }
      this.logger.info('editor open sent', { ...summary, editId });
      this.armAckTimer(entry, editId, false);

      // If the HTTP request from the CLI drops, clean up. The identity check
      // matters: `onAbort` also fires on normal completion, and by then
      // `editorPending` may already belong to a *newer* edit.
      const cleanup = () => {
        if (entry.editorPending?.resolve === resolve) {
          this.clearAckTimer(entry);
          entry.editorPending = null;
          this.logger.info('editor request aborted', { sessionId, filePath, editId });
          // Settle so the HTTP handler's `await` doesn't hang forever holding
          // this closure. Nobody is listening — the CLI is gone.
          resolve({ content, cancelled: true });
        }
      };
      onAbort(cleanup);
    });
  }

  /** The client reports its editor panel is on screen. A send that leaves the
   *  server proves nothing about the UI — this is the only positive signal that
   *  the user can actually see the editor. */
  ackEdit(sessionId: string, editId: number): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.editorPending || entry.editorPending.editId !== editId) {
      this.logger.warn('editor ack ignored', {
        sessionId, editId, pendingEditId: entry?.editorPending?.editId ?? null,
      });
      return false;
    }
    const pending = entry.editorPending;
    if (pending.acked) return true;
    pending.acked = true;
    this.clearAckTimer(entry);
    this.logger.info('editor panel acked', { sessionId, editId, filePath: pending.filePath });
    return true;
  }

  /** Wait for the ack; re-send once, then give up chasing it. The edit stays
   *  pending either way — a missing ack means "nobody can see this panel", not
   *  "the user is done", and failing the CLI on a lost ack would break edits
   *  that are working fine. The log is the payload here. */
  private armAckTimer(entry: SessionEntry, editId: number, retried: boolean): void {
    if (!entry.editorPending) return;
    const timer = setTimeout(() => {
      const pending = entry.editorPending;
      if (!pending || pending.editId !== editId || pending.acked) return;
      pending.ackTimer = null;
      const context = { sessionId: entry.sessionId, editId, filePath: pending.filePath };
      if (retried) {
        this.logger.error('editor panel never acked', { ...context, reason: 'no ack after re-send' });
        return;
      }
      const resent = entry.editorSender?.(editId, pending.filePath, pending.content, pending.contentType) ?? false;
      this.logger.warn('editor panel not acked — re-sending EDITOR_OPEN', { ...context, resent });
      if (resent) this.armAckTimer(entry, editId, true);
    }, EDITOR_ACK_TIMEOUT_MS);
    // Never hold the process open for an ack.
    timer.unref();
    entry.editorPending.ackTimer = timer;
  }

  private clearAckTimer(entry: SessionEntry): void {
    const timer = entry.editorPending?.ackTimer;
    if (timer) clearTimeout(timer);
    if (entry.editorPending) entry.editorPending.ackTimer = null;
  }

  /** `editId` is optional so a client that predates it still completes its edit;
   *  when present it must match, otherwise a stale panel (or an EDITOR_DONE
   *  queued through a reconnect) would resolve a *newer* edit with old content. */
  completeEdit(sessionId: string, content: string, cancelled: boolean, editId?: number): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.editorPending) {
      // The client had a panel open for an edit this session no longer owns
      // (stale panel after a session switch, or the CLI already gave up), so
      // the user's Save/Cancel does nothing visible. Loud on purpose.
      this.logger.warn('editor done ignored — no pending edit', { sessionId, editId: editId ?? null, cancelled, bytes: content.length });
      return false;
    }
    if (editId !== undefined && editId !== entry.editorPending.editId) {
      this.logger.warn('editor done ignored — stale edit id', {
        sessionId, editId, pendingEditId: entry.editorPending.editId, cancelled,
      });
      return false;
    }
    this.logger.info('editor completed', {
      sessionId,
      editId: entry.editorPending.editId,
      filePath: entry.editorPending.filePath,
      cancelled,
      bytes: content.length,
      acked: entry.editorPending.acked,
    });
    this.clearAckTimer(entry);
    entry.editorPending.resolve({ content, cancelled });
    entry.editorPending = null;
    return true;
  }

  // ── File Viewer ──────────────────────────────────────────────────────────

  setViewerSender(sessionId: string, fn: ViewerSender): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.viewerSender = fn;
  }

  /** Clear only if `fn` is still the registered sender — see clearEditorSender. */
  clearViewerSender(sessionId: string, fn: ViewerSender): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.viewerSender === fn) entry.viewerSender = null;
  }

  /** The session's views, oldest first — replayed on attach. */
  getViews(sessionId: string): ViewerOpenPayload[] {
    return this.sessions.get(sessionId)?.views.map(v => v.open) ?? [];
  }

  /** One open view, for validating VIEWER_REQUEST. */
  getView(sessionId: string, viewId: number): ViewerOpenPayload | undefined {
    return this.sessions.get(sessionId)?.views.find(v => v.open.viewId === viewId)?.open;
  }

  /** Replay the views a newly attached client can show, then VIEWER_SYNC so
   *  it drops views that closed while it was away. The rest stay queued; a CLI
   *  waiting on one of them (the previous client had it open) is released as
   *  `'queued'`, since nobody can close it until a capable client attaches. */
  replayViews(sessionId: string, send: ViewerSender, capabilities: ClientCapabilities = DEFAULT_CAPABILITIES): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const shown: ViewerOpenPayload[] = [];
    for (const view of entry.views) {
      if (capabilities.viewer.includes(view.kind)) {
        shown.push(view.open);
        continue;
      }
      if (view.resolve) {
        this.logger.info('viewer released as queued — client cannot show it', {
          sessionId, viewId: view.open.viewId, kind: view.kind,
        });
        const resolve = view.resolve;
        view.resolve = null;
        resolve('queued');
      }
    }
    for (const open of shown) send(VIEWER_OPEN, JSON.stringify(open));
    send(VIEWER_SYNC, JSON.stringify({ viewIds: shown.map(v => v.viewId) }));
  }

  /** Open a view. With a client attached that can show its kind, resolve
   *  `'closed'` when the user closes it; `onAbort` hooks the CLI's HTTP
   *  response, so if the CLI goes away the view is dropped and the client told
   *  to close it. Otherwise queue it, raise the session's alert, and resolve
   *  `'queued'` at once — the view opens in the next client that can show it.
   *  An attached client that can't gets a VIEWER_NOTICE saying so. */
  requestView(
    sessionId: string,
    request: ViewRequest,
    onAbort: (cleanup: () => void) => void,
  ): Promise<ViewOutcome> {
    const entry = this.sessions.get(sessionId);
    const { kind, ...listing } = request;
    const summary = {
      sessionId, root: listing.root, isDir: listing.isDir, initial: listing.initial ?? null, kind,
      entries: listing.entries.length, truncated: listing.truncated,
    };
    this.logger.info('viewer requested', summary);
    if (!entry) return Promise.reject(new Error('Session not found'));

    // A repeat of a queued view supersedes it rather than adding a tab.
    const repeat = entry.views.find(v => v.resolve === null
      && v.open.root === listing.root && v.open.isDir === listing.isDir && v.open.initial === listing.initial);
    if (repeat) this.dropView(entry, repeat, 'superseded');

    const open: ViewerOpenPayload = { viewId: this.nextViewId++, ...listing };
    const view: ViewState = { open, kind, resolve: null };
    entry.views.push(view);
    this.trimViews(entry);

    const capabilities = entry.attachedClient?.capabilities ?? DEFAULT_CAPABILITIES;
    if (entry.viewerSender && !capabilities.viewer.includes(kind)) {
      this.logger.info('viewer queued — attached client cannot show it', {
        ...summary, viewId: open.viewId, queued: entry.views.length,
      });
      const name = basename(listing.initial ?? listing.root) || listing.root;
      entry.viewerSender(VIEWER_NOTICE, JSON.stringify({
        viewId: open.viewId, message: `Queued ${name} (${kind}) for a client that can show it`,
      }));
      this.raiseAlert(entry, 'view');
      return Promise.resolve('queued');
    }

    if (entry.viewerSender?.(VIEWER_OPEN, JSON.stringify(open))) {
      this.logger.info('viewer open sent', { ...summary, viewId: open.viewId });
      return new Promise<ViewOutcome>((resolve) => {
        view.resolve = resolve;
        // Identity check: `onAbort` also fires after a normal close, and after
        // `replayViews` released this CLI and left the view queued.
        onAbort(() => {
          if (view.resolve !== resolve || !entry.views.includes(view)) return;
          this.dropView(entry, view, 'CLI gone');
        });
      });
    }

    this.logger.info('viewer queued — no client attached', {
      ...summary, viewId: open.viewId, sender: entry.viewerSender !== null, queued: entry.views.length,
    });
    this.raiseAlert(entry, 'view');
    return Promise.resolve('queued');
  }

  /** Send a viewer frame to whichever connection currently owns the session. */
  sendViewer(sessionId: string, cmd: number, json: string): boolean {
    return this.sessions.get(sessionId)?.viewerSender?.(cmd, json) ?? false;
  }

  /** The user closed a view. Ignored unless `viewId` is one of the session's. */
  completeView(sessionId: string, viewId: number): boolean {
    const entry = this.sessions.get(sessionId);
    const view = entry?.views.find(v => v.open.viewId === viewId);
    if (!entry || !view) {
      this.logger.warn('viewer done ignored', { sessionId, viewId, viewIds: entry?.views.map(v => v.open.viewId) ?? [] });
      return false;
    }
    entry.views.splice(entry.views.indexOf(view), 1);
    this.logger.info('viewer closed', { sessionId, viewId, remaining: entry.views.length });
    view.resolve?.('closed');
    return true;
  }

  /** Remove a view the user did not close, telling the client and releasing
   *  any waiting CLI. */
  private dropView(entry: SessionEntry, view: ViewState, reason: string): void {
    entry.views.splice(entry.views.indexOf(view), 1);
    this.logger.info('viewer dropped', { sessionId: entry.sessionId, viewId: view.open.viewId, reason });
    entry.viewerSender?.(VIEWER_CLOSE, JSON.stringify({ viewId: view.open.viewId }));
    view.resolve?.('closed');
  }

  private trimViews(entry: SessionEntry): void {
    while (entry.views.length > MAX_VIEWS_PER_SESSION) {
      const oldestQueued = entry.views.find(v => v.resolve === null);
      if (!oldestQueued) return;
      this.dropView(entry, oldestQueued, 'over cap');
    }
  }

  private raiseAlert(entry: SessionEntry, reason: AlertReason): void {
    entry.hasAlert = true;
    for (const cb of this.alertListeners) cb(entry.sessionId, reason);
  }

  private cancelViews(entry: SessionEntry): void {
    for (const view of entry.views) {
      this.logger.info('viewer closed — session gone', { sessionId: entry.sessionId, viewId: view.open.viewId });
      view.resolve?.('closed');
    }
    entry.views = [];
  }

  // ── File Download ────────────────────────────────────────────────────────

  setDownloadSender(sessionId: string, fn: (fileName: string, fileSize: number, token: string) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.downloadSender = fn;
  }

  /** Clear only if `fn` is still the registered sender — see clearEditorSender. */
  clearDownloadSender(sessionId: string, fn: (fileName: string, fileSize: number, token: string) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.downloadSender === fn) entry.downloadSender = null;
  }

  getDownloadSender(sessionId: string): ((fileName: string, fileSize: number, token: string) => void) | null {
    return this.sessions.get(sessionId)?.downloadSender ?? null;
  }

  // ── Clipboard (OSC 52) ───────────────────────────────────────────────────

  setClipboardSender(sessionId: string, fn: (text: string | null) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.clipboardSender = fn;
  }

  /** Clear only if `fn` is still the registered sender — see clearEditorSender. */
  clearClipboardSender(sessionId: string, fn: (text: string | null) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.clipboardSender === fn) entry.clipboardSender = null;
  }

  private cancelPendingEdit(entry: SessionEntry, reason = 'session gone'): void {
    if (entry.editorPending) {
      this.logger.info(`editor cancelled — ${reason}`, {
        sessionId: entry.sessionId, editId: entry.editorPending.editId, filePath: entry.editorPending.filePath,
      });
      this.clearAckTimer(entry);
      entry.editorPending.resolve({ content: entry.editorPending.content, cancelled: true });
      entry.editorPending = null;
    }
  }

  /** Kick off a background cwd probe for `entry`. Never awaited by callers —
   *  `resolveCwd` stays synchronous and non-blocking, and the resolved value is
   *  published to clients via the entry's change callbacks. */
  private refreshFallbackCwd(entry: SessionEntry): void {
    if (entry.fallbackCwdPending || !entry.alive) return;
    entry.fallbackCwdPending = true;
    const pid = entry.pid;
    getProcessCwd(pid).then(
      value => {
        entry.fallbackCwdPending = false;
        const previous = entry.fallbackCwd?.value ?? '';
        entry.fallbackCwd = { value, expiresAt: Date.now() + CWD_FALLBACK_TTL_MS };
        // Only wake clients when the answer actually changed, so a steady
        // stream of refreshes doesn't force needless frames.
        if (value !== previous) {
          for (const cb of entry.onChangeCallbacks) cb();
        }
      },
      () => {
        entry.fallbackCwdPending = false;
        entry.fallbackCwd = { value: '', expiresAt: Date.now() + CWD_FALLBACK_TTL_MS };
      },
    );
  }

  private resolveCwd(entry: SessionEntry): string {
    let raw = entry.reportedCwd;
    if (!raw) {
      const cached = entry.fallbackCwd;
      const now = Date.now();
      if (cached && cached.expiresAt > now) {
        raw = cached.value;
      } else {
        // Serve the stale value (or '') immediately and refresh out of band.
        // This MUST NOT block: it runs once per session per session-list build,
        // on the connect and session-switch paths.
        // See docs/done-bug-lsof-cwd-blocks-connect.md.
        this.refreshFallbackCwd(entry);
        raw = cached?.value ?? '';
      }
    }
    if (!raw) return '';
    if (raw === HOME) return '~';
    if (HOME && raw.startsWith(HOME + '/')) return '~' + raw.slice(HOME.length);
    return raw;
  }

  private toSessionInfo(entry: SessionEntry): SessionInfo {
    return {
      sessionId: entry.sessionId,
      name: entry.name,
      pid: entry.pid,
      alive: entry.alive,
      createdAt: entry.createdAt,
      command: entry.command,
      shell: entry.shell,
      title: entry.title,
      hasAlert: entry.hasAlert,
      cwd: this.resolveCwd(entry),
      scrollback: entry.headless?.options.scrollback ?? DEFAULT_SCROLLBACK,
    };
  }
}
