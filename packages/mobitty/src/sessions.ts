import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { release, homedir } from 'node:os';
import type { PtyHandle, SessionInfo, EditorResult } from './types.ts';
import { spawnPty, writePty, resizePty, killPty } from './pty.ts';
import { generateUniqueSessionName } from './session-names.ts';
import type { LoggerInterface } from './types.ts';
import headlessPkg from '@xterm/headless';
const { Terminal } = headlessPkg;
import serializePkg from '@xterm/addon-serialize';
const { SerializeAddon } = serializePkg;
import { trackCursorVisibility } from './cursor-visibility.ts';
import type { CursorVisibilityTracker } from './cursor-visibility.ts';
import { trackMouseEncoding } from './mouse-encoding.ts';
import type { MouseEncodingTracker } from './mouse-encoding.ts';
import { registerNotificationHandlers } from './osc-notifications.ts';
import { registerCwdHandler } from './osc-cwd.ts';
import { registerColorQueryHandlers } from './osc-color-query.ts';
import type { OscColorQueryTracker, OscColorConfig } from './osc-color-query.ts';
import { BUILTIN_THEMES } from './themes.ts';
import { normalizeSgrColors } from './sgr-normalize.ts';
import { bufferStats, summarizeBytes, sampleBufferLines, sampleAltBuffer, detectLineRepetition } from './diff.ts';
import type { MouseEncoding } from './diff.ts';
import { getProcessCwd } from './clipboard.ts';

const HOME = homedir();
const CWD_FALLBACK_TTL_MS = 2000;

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
  serializeAddon: InstanceType<typeof SerializeAddon> | null;
  cursorTracker: CursorVisibilityTracker | null;
  colorTracker: OscColorQueryTracker | null;
  mouseEncodingTracker: MouseEncodingTracker | null;
  title: string;
  hasAlert: boolean;
  /** Last-known absolute CWD reported via OSC 7. Empty until a shell reports it. */
  reportedCwd: string;
  /** Cached fallback (getProcessCwd) value with expiry, used when no OSC 7 yet. */
  fallbackCwd: { value: string; expiresAt: number } | null;
  onExitCallbacks: Array<() => void>;
  onDetachCallbacks: Array<() => void>;
  onChangeCallbacks: Array<() => void>;
  editorPending: {
    filePath: string;
    content: string;
    contentType?: string;
    resolve: (result: EditorResult) => void;
  } | null;
  editorSender: ((filePath: string, content: string, contentType?: string) => void) | null;
  downloadSender: ((fileName: string, fileSize: number, token: string) => void) | null;
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
  private alertListeners = new Set<(sessionId: string) => void>();
  private notificationListeners = new Set<(sessionId: string, title: string, body: string) => void>();
  private maxSessions: number;
  private startDir: string;

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
        serializeAddon: null,
        cursorTracker: null,
        colorTracker: null,
        mouseEncodingTracker: null,
        title: '',
        hasAlert: false,
        reportedCwd: '',
        fallbackCwd: null,
        onExitCallbacks: [],
        onDetachCallbacks: [],
        onChangeCallbacks: [],
        editorPending: null,
        editorSender: null,
        downloadSender: null,
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
    const serializeAddon = new SerializeAddon();
    // SerializeAddon is typed against @xterm/xterm's Terminal but is structurally
    // identical to @xterm/headless's; the runtime API is the same.
    headless.loadAddon(serializeAddon as unknown as Parameters<typeof headless.loadAddon>[0]);
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
    // captureSnapshot/serializeFullState via getMouseEncoding(). Without this a
    // TUI's SGR mouse mode (`\x1b[?1006h`, e.g. Copilot CLI) never reaches the
    // client and mouse-move reports arrive as garbled X10 bytes. See
    // docs/done-bug-copilot-mouse-sgr-encoding-not-serialized.md.
    const mouseEncodingTracker = trackMouseEncoding(headless, (encoding) => {
      if (this.logger.isEnabled('debug')) {
        this.logger.debug('mouse-encoding-change', { sessionId, encoding });
      }
      notifyChange();
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
      entry.hasAlert = true;
      for (const cb of this.alertListeners) cb(sessionId);
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
          const entry = this.sessions.get(sessionId);
          if (entry) {
            entry.alive = false;
            entry.handle = null;
            this.persist();
            this.logger.info('session process exited', { sessionId, name });
            for (const cb of entry.onExitCallbacks) cb();
            entry.onExitCallbacks.length = 0;
          }
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
      serializeAddon,
      cursorTracker,
      colorTracker,
      mouseEncodingTracker,
      title,
      hasAlert: false,
      reportedCwd: '',
      fallbackCwd: null,
      onExitCallbacks,
      onDetachCallbacks,
      onChangeCallbacks,
      editorPending: null,
      editorSender: null,
      downloadSender: null,
      scrollCount: 0,
    };

    this.sessions.set(sessionId, entry);
    this.persist();
    this.logger.info('session created', { sessionId, name, pid: handle.pid });

    return { info: this.toSessionInfo(entry), handle };
  }

  attachSession(sessionId: string, onExit: () => void, onDetach: () => void): SessionInfo | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.alive || !entry.handle) return undefined;

    entry.onExitCallbacks.push(onExit);
    entry.onDetachCallbacks.push(onDetach);
    return this.toSessionInfo(entry);
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

  getSerializeAddon(sessionId: string): InstanceType<typeof SerializeAddon> | null {
    return this.sessions.get(sessionId)?.serializeAddon ?? null;
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

  addAlertListener(cb: (sessionId: string) => void): () => void {
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

  getMouseEncoding(sessionId: string): MouseEncoding {
    return this.sessions.get(sessionId)?.mouseEncodingTracker?.encoding ?? 'default';
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
    if (entry.serializeAddon) {
      entry.serializeAddon.dispose();
      entry.serializeAddon = null;
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
      if (entry.serializeAddon) {
        entry.serializeAddon.dispose();
        entry.serializeAddon = null;
      }
      if (entry.headless) {
        entry.headless.dispose();
        entry.headless = null;
      }
    }
    this.sessions.clear();
    this.persist();
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

    resizePty(entry.handle, columns, rows);
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

  setEditorSender(sessionId: string, fn: (filePath: string, content: string, contentType?: string) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.editorSender = fn;
  }

  clearEditorSender(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.editorSender = null;
  }

  getEditorPending(sessionId: string): { filePath: string; content: string; contentType?: string } | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry?.editorPending) return undefined;
    const { filePath, content, contentType } = entry.editorPending;
    return contentType ? { filePath, content, contentType } : { filePath, content };
  }

  requestEdit(sessionId: string, filePath: string, content: string, onAbort: (cleanup: () => void) => void, contentType?: string): Promise<EditorResult> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return Promise.reject(new Error('Session not found'));
    if (entry.editorPending) return Promise.reject(new Error('Edit already in progress'));
    if (!entry.editorSender) return Promise.reject(new Error('No client connected'));

    return new Promise<EditorResult>((resolve) => {
      entry.editorPending = { filePath, content, contentType, resolve };
      entry.editorSender!(filePath, content, contentType);

      // If the HTTP request from the CLI drops, clean up
      const cleanup = () => {
        if (entry.editorPending?.resolve === resolve) {
          entry.editorPending = null;
        }
      };
      onAbort(cleanup);
    });
  }

  completeEdit(sessionId: string, content: string, cancelled: boolean): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.editorPending) return false;
    entry.editorPending.resolve({ content, cancelled });
    entry.editorPending = null;
    return true;
  }

  // ── File Download ────────────────────────────────────────────────────────

  setDownloadSender(sessionId: string, fn: (fileName: string, fileSize: number, token: string) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.downloadSender = fn;
  }

  clearDownloadSender(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.downloadSender = null;
  }

  getDownloadSender(sessionId: string): ((fileName: string, fileSize: number, token: string) => void) | null {
    return this.sessions.get(sessionId)?.downloadSender ?? null;
  }

  private cancelPendingEdit(entry: SessionEntry): void {
    if (entry.editorPending) {
      entry.editorPending.resolve({ content: entry.editorPending.content, cancelled: true });
      entry.editorPending = null;
    }
  }

  private resolveCwd(entry: SessionEntry): string {
    let raw = entry.reportedCwd;
    if (!raw) {
      const cached = entry.fallbackCwd;
      const now = Date.now();
      if (cached && cached.expiresAt > now) {
        raw = cached.value;
      } else if (entry.alive) {
        raw = getProcessCwd(entry.pid);
        entry.fallbackCwd = { value: raw, expiresAt: now + CWD_FALLBACK_TTL_MS };
      } else {
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
    };
  }
}
