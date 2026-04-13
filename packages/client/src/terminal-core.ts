// Imperative terminal core — WebSocket, flow control, escape encoding, key dispatch.
// No React, no DOM creation. Receives a container element and manages xterm.js.

import type { IDisposable, ITerminalOptions } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { OverlayAddon } from './overlay';
import { SelectionOverlayAddon } from './selection-overlay';
import type { Profile, ProfileTheme, SoftkeyKeySettings } from './profiles';
import type { KeyBehavior, ModifierFlags, VirtualKey, ComboStep, KeySpec } from './softkey-types';
import { getKeySpec, emptyModifiers } from './softkey-types';
import type { GestureId, GestureMapping } from './gesture-types';
import { DEFAULT_GESTURE_MAPPING } from './gesture-types';
import { GestureDetector } from './gesture-detector';
import { ClientLogger } from './client-logger';
import type { SessionInfo } from './sessions';

const CMD_CLIPBOARD_IMAGE = 0x36;
const CMD_CLIPBOARD_IMAGE_ACK = 0x36;
const CMD_RTT_REPORT = 0x37;
const CMD_SESSION_ALERT = 0x38;
const CMD_SESSION_NOTIFICATION = 0x3a;
const CMD_UPDATE_SETTINGS = 0x32;
const CMD_EDITOR_OPEN = 0x3b;
const CMD_EDITOR_DONE = 0x3a;
const CMD_DOWNLOAD_START = 0x3c;

/** Delay before tearing down GPU renderer when the tab is hidden.
 *  Avoids thrashing on quick tab switches while still freeing the GPU
 *  context for tabs that stay backgrounded. */
const MAX_PASTE_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB

const RENDERER_TEARDOWN_DELAY_MS = 5000;

const Command = {
  SET_WINDOW_TITLE: '1',
  SET_PREFERENCES: '2',
  SET_SESSION_INFO: '3',
  STATE_UPDATE: '4',
  STATE_FULL: '5',
  INPUT: '0',
  RESIZE_TERMINAL: '1',
} as const;

type RendererType = 'dom' | 'canvas' | 'webgl';

interface ClientOptions {
  rendererType: RendererType;

  disableResizeOverlay: boolean;
  enableSixel: boolean;
  titleFixed?: string;
  isWindows: boolean;
  unicodeVersion: string;
  closeOnDisconnect: boolean;
}

export interface ModifierSource {
  consumeModifiers(): ModifierFlags;
  clearModifiers(): void;
  consumeModifierForTapSelection(modifier: 'alt' | 'shift'): boolean;
}

export interface ImagePasteErrorInfo {
  clipboardError?: string;
  fileError?: string;
  imagePasteDir?: string;
}

export type ConnectionClosedReason = 'replaced' | 'closed';

export interface TerminalCoreCallbacks {
  onTitleChange?: (title: string) => void;
  onSessionInfo?: (info: SessionInfo) => void;
  onSessionDied?: (sessionId: string) => void;
  onSessionNotFound?: () => void;
  onConnectionClosed?: (reason: ConnectionClosedReason) => void;
  onRttReport?: (rttMs: number) => void;
  onBytesSent?: (bytes: number) => void;
  onBytesReceived?: (bytes: number) => void;
  onTargetFps?: (fps: number) => void;
  onSessionAlert?: (sessionId: string) => void;
  onSessionNotification?: (sessionId: string, title: string, body: string, sessionName: string, sessionTitle: string) => void;
  onImagePasteError?: (error: ImagePasteErrorInfo) => void;
  onEditorOpen?: (filePath: string, content: string, contentType?: string) => void;
  onDownloadStart?: (fileName: string, fileSize: number, token: string) => void;
}

export interface TerminalCoreOptions {
  wsUrl: string;
  tokenUrl: string;
  clientOptions: ClientOptions;
  termOptions: ITerminalOptions;
  sessionId?: string;
  shellName?: string;
}

function addEventListener(target: EventTarget, type: string, listener: EventListener): IDisposable {
  target.addEventListener(type, listener);
  return { dispose: () => target.removeEventListener(type, listener) };
}

export class TerminalCore {
  // Cleared on every reconnect (dispose()) — only socket-scoped listeners belong here.
  // See: workspace/docs/design-listeners.md
  private socketDisposables: IDisposable[] = [];

  // Cleared only on full unmount (destroy()) — terminal-element-scoped resources belong here.
  // See: workspace/docs/design-listeners.md
  private terminalDisposables: IDisposable[] = [];
  private textEncoder = new TextEncoder();
  private textDecoder = new TextDecoder();
  private singleCharBuf = new Uint8Array(2);

  private terminal!: Terminal;
  private fitAddon = new FitAddon();
  private overlayAddon = new OverlayAddon();
  private selectionOverlay?: SelectionOverlayAddon;
  private webLinksAddon = new WebLinksAddon();
  private webglAddon?: WebglAddon;
  private canvasAddon?: CanvasAddon;

  private socket?: WebSocket;
  private token = '';
  private opened = false;
  private title?: string;
  private titleFixed?: string;
  private resizeOverlay = true;
  private autoReconnect = true;
  private doReconnect = true;
  private closeOnDisconnect = false;
  private reconnectDelay = 0;
  private gestureDetector?: GestureDetector;
  private lastGestureCenter: { x: number; y: number } = { x: 0, y: 0 };
  private gestureMapping: GestureMapping = DEFAULT_GESTURE_MAPPING;
  private customKeyMap?: Map<string, KeySpec>;
  private clipboardImageRequestId = 0;
  private pendingClipboardImageResolve?: (result: { status: number; errorInfo?: ImagePasteErrorInfo }) => void;

  private modifierSource?: ModifierSource;
  private logger: ClientLogger;
  callbacks: TerminalCoreCallbacks = {};

  private currentSessionId?: string;
  private softkeySettings: Record<string, SoftkeyKeySettings> = {};
  private scrollback: number;
  private imagePasteDir?: string;
  private notificationMode: 'iterm' | 'kitty' | 'ghostty' | 'off' = 'ghostty';
  private remoteEditor = false;
  private copyOnSelect = false;
  private themeForeground?: string;
  private themeBackground?: string;
  private scrollbarHealthTimer?: ReturnType<typeof setInterval>;
  private scrollbarStuckCount = 0;
  private preferredRendererType: RendererType = 'dom';
  private rendererTeardownTimer?: ReturnType<typeof setTimeout>;
  private pendingConnectRaf?: number;

  constructor(private options: TerminalCoreOptions) {
    this.scrollback = this.options.termOptions.scrollback ?? 5000;
    this.logger = new ClientLogger({
      sendToServer: (payload) => { try { this.socket?.send(payload); } catch { /* socket may be closing */ } },
    });
  }

  dispose() {
    if (this.pendingConnectRaf !== undefined) {
      cancelAnimationFrame(this.pendingConnectRaf);
      this.pendingConnectRaf = undefined;
    }
    this.selectionOverlay?.dismiss();
    for (const d of this.socketDisposables) d.dispose();
    this.socketDisposables.length = 0;
  }

  /** Full teardown — call on unmount (not on reconnect). */
  destroy() {
    this.dispose();
    for (const d of this.terminalDisposables) d.dispose();
    this.terminalDisposables.length = 0;
    this.terminal?.dispose();
  }

  private registerSocket<T extends IDisposable>(d: T): T {
    this.socketDisposables.push(d);
    return d;
  }

  private registerTerminal<T extends IDisposable>(d: T): T {
    this.terminalDisposables.push(d);
    return d;
  }

  setModifierSource(source: ModifierSource | undefined) {
    this.modifierSource = source;
  }

  setScrollback(n: number) {
    this.scrollback = n;
    if (this.terminal) {
      this.terminal.options.scrollback = n;
    }
    this.sendUpdateSettings();
  }

  setImagePasteDir(dir: string) {
    this.imagePasteDir = dir;
    this.sendUpdateSettings();
  }

  setNotificationMode(mode: 'iterm' | 'kitty' | 'ghostty' | 'off') {
    this.notificationMode = mode;
    this.sendUpdateSettings();
  }

  setRemoteEditor(enabled: boolean) {
    this.remoteEditor = enabled;
    this.sendUpdateSettings();
  }

  sendEditorDone(content: string, cancelled: boolean) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const payload = JSON.stringify({ content, cancelled });
    const encoded = this.textEncoder.encode(payload);
    const msg = new Uint8Array(1 + encoded.length);
    msg[0] = CMD_EDITOR_DONE;
    msg.set(encoded, 1);
    this.socket.send(msg);
  }

  private sendUpdateSettings() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const payload = JSON.stringify({
      scrollback: this.scrollback,
      imagePasteDir: this.imagePasteDir,
      notificationMode: this.notificationMode,
      remoteEditor: this.remoteEditor,
      themeForeground: this.themeForeground,
      themeBackground: this.themeBackground,
    });
    const encoded = this.textEncoder.encode(payload);
    const msg = new Uint8Array(1 + encoded.length);
    msg[0] = CMD_UPDATE_SETTINGS;
    msg.set(encoded, 1);
    this.socket.send(msg);
  }


  setGestureMapping(mapping: GestureMapping): void {
    this.gestureMapping = mapping;
    this.gestureDetector?.updateMapping(mapping);
    this.gestureDetector?.updateContinuousScrollGestures(this.computeContinuousScrollGestures());
  }

  setSoftkeySettings(settings: Record<string, SoftkeyKeySettings>): void {
    this.softkeySettings = settings;
  }

  setCustomKeyMap(map: Map<string, KeySpec>): void {
    this.customKeyMap = map;
    this.gestureDetector?.updateContinuousScrollGestures(this.computeContinuousScrollGestures());
  }

  async refreshToken() {
    try {
      const resp = await fetch(this.options.tokenUrl);
      if (resp.ok) {
        const json = await resp.json() as { token: string };
        this.token = json.token;
      }
    } catch {
      this.logger.warn('fetch token failed');
    }
  }

  open(parent: HTMLElement) {
    this.terminal = new Terminal(this.options.termOptions);
    const { terminal, fitAddon, overlayAddon, webLinksAddon } = this;

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(overlayAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(parent);

    this.selectionOverlay = new SelectionOverlayAddon({
      isTouchDevice: () => this.isTouchDevice(),
      onPaste: () => void this.handlePaste(),
    });
    terminal.loadAddon(this.selectionOverlay);
    this.registerTerminal({ dispose: () => { this.selectionOverlay?.dispose(); this.selectionOverlay = undefined; } });
    this.registerKeyInterceptor();
    this.registerNativePasteImageHandler();
    this.syncPageBackground();
    fitAddon.fit();

    const observer = new ResizeObserver(() => this.fitAddon.fit());
    observer.observe(parent);
    this.registerTerminal({ dispose: () => observer.disconnect() });
    this.registerRendererVisibility();
    this.registerWheelDiagnostics();
    this.registerGestureDetection();
    this.startScrollbarHealthCheck();
    this.registerTerminal({ dispose: () => this.stopScrollbarHealthCheck() });
    this.registerTerminal(terminal.onTitleChange(data => {
      if (data && data !== '' && !this.titleFixed) {
        this.title = data;
        document.title = data;
        this.callbacks.onTitleChange?.(data);
      }
    }));
    this.registerTerminal(terminal.onSelectionChange(() => this.onSelectionChange()));
    this.registerWakeDetection();
  }

  applyProfile(profile: Profile, themeColors?: ProfileTheme): void {
    this.options.termOptions.fontSize = profile.fontSize;
    this.options.termOptions.fontFamily = profile.fontFamily;
    this.options.termOptions.scrollback = profile.scrollback;
    this.options.termOptions.macOptionIsMeta = profile.optionIsMeta;
    if (themeColors) {
      this.options.termOptions.theme = themeColors;
      this.themeForeground = themeColors.foreground;
      this.themeBackground = themeColors.background;
    }
    this.terminal.options.fontSize = profile.fontSize;
    this.terminal.options.fontFamily = profile.fontFamily;
    this.terminal.options.scrollback = profile.scrollback;
    this.terminal.options.macOptionIsMeta = profile.optionIsMeta;
    this.scrollback = profile.scrollback;
    if (themeColors) {
      this.terminal.options.theme = { ...this.terminal.options.theme, ...themeColors };
    }
    this.copyOnSelect = profile.copyOnSelect;
    this.syncPageBackground();
    this.fitAddon.fit();
  }

  connect() {
    this.socket = new WebSocket(this.options.wsUrl, ['tty']);
    const { socket } = this;

    socket.binaryType = 'arraybuffer';
    this.registerSocket(addEventListener(socket, 'open', () => this.onSocketOpen()));
    this.registerSocket(addEventListener(socket, 'message', (e) => this.onSocketData(e as MessageEvent)));
    this.registerSocket(addEventListener(socket, 'close', (e) => this.onSocketClose(e as CloseEvent)));
  }

  /** Manual reconnect — called by the React UI when user clicks Reconnect. */
  reconnect() {
    this.logger.info('manual reconnect');
    this.doReconnect = true;
    this.reconnectDelay = 0;
    this.refreshToken().then(() => this.connect());
  }

  focus() {
    this.terminal?.focus();
  }

  switchSession(sessionId: string, shellName?: string) {
    this.logger.info('switching session', { sessionId: sessionId || null, shell: shellName ?? null });
    this.logger.setSession(sessionId || null);
    this.options.sessionId = sessionId;
    this.options.shellName = shellName;
    this.doReconnect = true;
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      this.socket.close(4001, 'Switching session');
    } else {
      // Socket already closed (e.g. process exited) — connect directly
      this.refreshToken().then(() => this.connect());
    }
  }

  sendData(data: string | Uint8Array) {
    const { socket } = this;
    if (socket?.readyState !== WebSocket.OPEN) return;

    if (typeof data === 'string') {
      const outgoing = this.modifierSource ? this.applyModifierToText(data) : data;

      if (outgoing.length === 1) {
        this.singleCharBuf[0] = Command.INPUT.charCodeAt(0);
        this.singleCharBuf[1] = outgoing.charCodeAt(0);
        socket.send(this.singleCharBuf);
        this.callbacks.onBytesSent?.(2);
      } else {
        const encoded = this.textEncoder.encode(Command.INPUT + outgoing);
        socket.send(encoded);
        this.callbacks.onBytesSent?.(encoded.byteLength);
      }
    } else {
      const payload = new Uint8Array(data.length + 1);
      payload[0] = Command.INPUT.charCodeAt(0);
      payload.set(data, 1);
      socket.send(payload);
      this.callbacks.onBytesSent?.(payload.byteLength);
    }
  }

  // --- Public action handlers (called from SoftkeyBar) ---

  handleSoftkeyAction(action: KeyBehavior, modifiers: ModifierFlags) {
    this.dispatchKeyAction(action, modifiers);
    this.keepTerminalFocus();
  }

  /** Dispatch without re-focusing — used by gesture callbacks to avoid opening the keyboard. */
  dispatchKeyAction(action: KeyBehavior, modifiers: ModifierFlags) {
    switch (action.kind) {
      case 'send-virtual': this.sendVirtualKey(action.key, modifiers); break;
      case 'send-char': this.sendDynamicChar(action.char, modifiers); break;
      case 'send-combo': this.modifierSource?.clearModifiers(); this.sendDynamicCombo(action.combo); break;
      case 'wheel-step': this.sendVirtualWheelStep(action.direction); break;
      case 'select-line': this.selectLineAtPoint(this.lastGestureCenter); break;
      case 'select-visible-lines': this.selectVisibleViewportLines(); break;
      case 'select-all': this.terminal?.selectAll(); requestAnimationFrame(() => this.selectionOverlay?.show()); break;
      case 'toggle-modifier': break;
      case 'batch-input-toggle': break;
      case 'inline-input': break;
      case 'meter-toggle': break;
      case 'container-toggle': break;
    }
  }

  handleBatchInput(text: string) {
    if (text === '') return;
    this.modifierSource?.clearModifiers();
    this.terminal?.paste(text);
    this.overlayAddon?.showOverlay('Paste', 300);
    this.keepTerminalFocus();
  }

  /** Read clipboard and paste into the terminal.  Supports both images
   *  (via clipboard.read()) and text (via clipboard.readText()).  Falls back
   *  to execCommand('paste') on non-secure contexts.
   *  Must be called from a user-gesture event handler. */
  async handlePaste(): Promise<void> {
    let clipboardError = '';
    // Try clipboard.read() first — it can return images and text.
    if (navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            if (blob.size > 0 && blob.size <= MAX_PASTE_IMAGE_BYTES) {
              void this.handleNativePasteImage(blob, imageType);
              return;
            }
          }
          if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            const text = await blob.text();
            if (text !== '') {
              this.handleBatchInput(text);
              return;
            }
          }
        }
      } catch (err) {
        clipboardError = err instanceof Error ? err.message : String(err);
      }
    } else if (!navigator.clipboard) {
      clipboardError = 'Clipboard API unavailable (requires HTTPS)';
    }
    // Fallback: readText() — narrower but wider browser support for text.
    if (navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text !== '') {
          this.handleBatchInput(text);
          return;
        }
      } catch (err) {
        if (!clipboardError) {
          clipboardError = err instanceof Error ? err.message : String(err);
        }
      }
    }
    // Last resort: execCommand('paste') — deprecated but works in some browsers.
    try {
      const tmp = document.createElement('textarea');
      tmp.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(tmp);
      tmp.focus();
      document.execCommand('paste');
      const text = tmp.value;
      tmp.remove();
      if (text !== '') {
        this.handleBatchInput(text);
        return;
      }
    } catch { /* not supported */ }
    // All methods failed — show error dialog if we have a clipboard error,
    // otherwise a brief overlay for an empty clipboard.
    if (clipboardError) {
      this.logger.warn('paste-clipboard-error', { clipboardError });
      this.callbacks.onImagePasteError?.({ clipboardError });
    } else {
      this.overlayAddon?.showOverlay('Clipboard empty', 700);
    }
    this.keepTerminalFocus();
  }

  // --- Private helpers ---

  private syncPageBackground() {
    const bg = this.terminal?.options.theme?.background;
    if (typeof bg === 'string' && bg !== '') {
      document.documentElement.style.backgroundColor = bg;
      document.body.style.backgroundColor = bg;
      const root = document.getElementById('root');
      if (root) root.style.backgroundColor = bg;
    }
  }


  // --- Scrollbar health monitoring ---

  private getScrollbarDiagnostics(): Record<string, unknown> {
    const buf = this.terminal.buffer.active;
    const el = this.terminal.element;
    const viewport = el?.querySelector('.xterm-viewport') as HTMLElement | null;
    const scrollArea = el?.querySelector('.xterm-scroll-area') as HTMLElement | null;
    return {
      baseY: buf.baseY,
      viewportY: buf.viewportY,
      bufferLength: buf.length,
      scrollbackOption: this.terminal.options.scrollback,
      rows: this.terminal.rows,
      cols: this.terminal.cols,
      vpScrollHeight: viewport?.scrollHeight ?? -1,
      vpClientHeight: viewport?.clientHeight ?? -1,
      vpScrollTop: viewport?.scrollTop ?? -1,
      scrollAreaHeight: scrollArea?.offsetHeight ?? -1,
      hasScrollback: buf.baseY > 0,
      isScrollable: (viewport?.scrollHeight ?? 0) > (viewport?.clientHeight ?? 0),
    };
  }

  private isScrollbarStuck(): boolean {
    const buf = this.terminal.buffer.active;
    if (buf.baseY === 0) return false;
    const viewport = this.terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null;
    if (!viewport) return false;
    return viewport.scrollHeight <= viewport.clientHeight;
  }

  private startScrollbarHealthCheck(): void {
    this.stopScrollbarHealthCheck();
    this.scrollbarStuckCount = 0;
    this.scrollbarHealthTimer = setInterval(() => this.checkScrollbarHealth(), 10_000);
  }

  private stopScrollbarHealthCheck(): void {
    if (this.scrollbarHealthTimer !== undefined) {
      clearInterval(this.scrollbarHealthTimer);
      this.scrollbarHealthTimer = undefined;
    }
  }

  private checkScrollbarHealth(): void {
    if (!this.terminal?.element) return;
    if (this.isScrollbarStuck()) {
      this.scrollbarStuckCount++;
      this.logger.warn('scrollbar-stuck-detected', {
        ...this.getScrollbarDiagnostics(),
        consecutiveCount: this.scrollbarStuckCount,
      });
      if (this.scrollbarStuckCount >= 2) {
        this.attemptScrollbarRecovery();
      }
    } else {
      if (this.scrollbarStuckCount > 0) {
        this.logger.info('scrollbar-unstuck', {
          previousStuckCount: this.scrollbarStuckCount,
        });
      }
      this.scrollbarStuckCount = 0;
    }
  }

  private attemptScrollbarRecovery(): void {
    this.logger.info('scrollbar-recovery-start', this.getScrollbarDiagnostics());
    const savedViewportY = this.terminal.buffer.active.viewportY;

    // Phase 1: Force render refresh + scroll poke
    this.terminal.refresh(0, this.terminal.rows - 1);
    this.terminal.scrollToBottom();
    requestAnimationFrame(() => {
      this.terminal.scrollToLine(savedViewportY);

      if (!this.isScrollbarStuck()) {
        this.logger.info('scrollbar-recovery-success', { method: 'refresh-poke' });
        this.scrollbarStuckCount = 0;
        this.overlayAddon.showOverlay('Scroll fixed', 500);
        return;
      }

      // Phase 2: Clear scrollback separately, then request STATE_FULL
      this.logger.info('scrollbar-recovery-escalating', { method: 'clear-then-state-full' });
      const clearScrollback = new Uint8Array([0x1b, 0x5b, 0x33, 0x4a]); // \x1b[3J
      this.terminal.write(clearScrollback, () => {
        // Request STATE_FULL from server by sending current dimensions as resize
        const msg = JSON.stringify({ columns: this.terminal.cols, rows: this.terminal.rows });
        this.socket?.send(this.textEncoder.encode(Command.RESIZE_TERMINAL + msg));
        this.scrollbarStuckCount = 0;
        this.overlayAddon.showOverlay('Scroll repair', 500);
      });
    });
  }

  /** Capture-phase wheel listener that logs diagnostics for scroll issues.
   *  See: workspace/docs/bug-windows-wheel-scroll.md */
  private registerWheelDiagnostics(): void {
    const element = this.terminal?.element;
    if (!element) return;

    let lastLogTime = 0;
    let stuckCount = 0;
    const RATE_LIMIT_MS = 2_000;
    const STUCK_THRESHOLD = 3;

    const viewport = element.querySelector('.xterm-viewport');
    const handler = (ev: WheelEvent) => {
      if (!(viewport instanceof HTMLElement)) return;

      const scrollTopBefore = viewport.scrollTop;
      const mouseTracking = element.classList.contains('enable-mouse-events');

      // Check after the event has been processed by xterm.js
      requestAnimationFrame(() => {
        const scrollTopAfter = viewport.scrollTop;
        const moved = scrollTopAfter !== scrollTopBefore;

        if (moved) {
          if (stuckCount >= STUCK_THRESHOLD) {
            this.logger.info('wheel-scroll-diag', { event: 'unstuck', previousStuckCount: stuckCount });
          }
          stuckCount = 0;
          return;
        }

        // Viewport didn't move — possible stuck condition
        const atBottom = viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 1;
        const atTop = viewport.scrollTop <= 0;
        const scrollingDown = ev.deltaY > 0;
        const atEdge = (scrollingDown && atBottom) || (!scrollingDown && atTop);

        // Being at the scroll edge is normal — not stuck
        if (atEdge) {
          stuckCount = 0;
          return;
        }

        stuckCount++;
        const now = Date.now();
        if (now - lastLogTime < RATE_LIMIT_MS) return;
        lastLogTime = now;

        const data = {
          mouseTracking,
          stuckCount,
          deltaY: ev.deltaY,
          deltaMode: ev.deltaMode,
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
          baseY: this.terminal?.buffer?.active?.baseY ?? -1,
          defaultPrevented: ev.defaultPrevented,
        };

        if (stuckCount >= STUCK_THRESHOLD) {
          this.logger.warn('wheel-scroll-diag', { event: 'stuck', ...data });
        } else {
          this.logger.debug('wheel-scroll-diag', { event: 'no-move', ...data });
        }
      });
    };

    // Capture phase so we see the event before xterm.js's handlers
    element.addEventListener('wheel', handler, { capture: true, passive: true });
    this.registerTerminal({ dispose: () => element.removeEventListener('wheel', handler, { capture: true }) });
  }

  isTouchDevice(): boolean {
    return (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) &&
      window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  private keepTerminalFocus() {
    this.terminal?.focus();
    requestAnimationFrame(() => this.terminal?.focus());
  }

  private registerGestureDetection() {
    if (!this.isTouchDevice()) return;
    const element = this.terminal?.element;
    if (!element) return;

    this.gestureDetector = new GestureDetector(element, this.gestureMapping, {
      onGesture: (gestureId, center) => {
        const keyId = this.gestureMapping[gestureId];
        if (!keyId) return;
        const spec = getKeySpec(keyId, this.customKeyMap);
        this.lastGestureCenter = center;
        this.dispatchKeyAction(spec.behavior, emptyModifiers());
      },
      onContinuousScroll: (deltaY) => {
        this.sendWheelDelta(deltaY);
      },
      onLongPressDefault: (clientX, clientY) => {
        this.dispatchTouchMultiClick(2, clientX, clientY);
        requestAnimationFrame(() => this.selectionOverlay?.show());
      },
    }, this.computeContinuousScrollGestures());
    this.registerTerminal({ dispose: () => { this.gestureDetector?.dispose(); this.gestureDetector = undefined; } });
  }

  private dispatchTouchMultiClick(detail: number, clientX: number, clientY: number) {
    const element = this.terminal?.element;
    if (!element) return;
    const ownerDoc = element.ownerDocument ?? document;
    const init = {
      bubbles: true, cancelable: true, button: 0, buttons: 1, detail,
      clientX, clientY, screenX: clientX, screenY: clientY,
      view: ownerDoc.defaultView ?? window,
    };
    element.dispatchEvent(new MouseEvent('mousedown', init));
    element.dispatchEvent(new MouseEvent('mouseup', init));
  }

  private selectLineAtPoint(center: { x: number; y: number }) {
    this.dispatchTouchMultiClick(3, center.x, center.y);
    requestAnimationFrame(() => this.selectionOverlay?.show());
  }

  private selectVisibleViewportLines() {
    const terminal = this.terminal;
    if (!terminal) return;
    const start = Math.max(0, terminal.buffer.active.viewportY);
    const end = Math.min(terminal.buffer.active.length - 1, start + Math.max(1, terminal.rows) - 1);
    if (end < start) return;
    terminal.selectLines(start, end);
    requestAnimationFrame(() => this.selectionOverlay?.show());
  }

  // --- Keyboard shortcuts ---

  private registerKeyInterceptor() {
    this.terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey
          || event.altKey || event.metaKey) {
        return true;
      }

      // Ctrl+Shift+Home: manual scrollbar recovery
      if (event.key === 'Home') {
        event.preventDefault();
        this.logger.info('scrollbar-recovery-manual');
        this.attemptScrollbarRecovery();
        return false;
      }

      // Ctrl+Shift+C: copy selection to clipboard
      if (event.key === 'C') {
        const selection = this.terminal.getSelection();
        if (selection !== '') {
          void this.autoCopySelection(selection);
          this.terminal.clearSelection();
          return false;
        }
        return true;
      }

      // Ctrl+Shift+V: paste from clipboard
      if (event.key === 'V') {
        void this.handlePaste();
        return false;
      }

      return true;
    });
  }

  private onSelectionChange() {
    if (!this.copyOnSelect) return;

    const selection = this.terminal.getSelection();
    if (selection === '') return;

    void this.autoCopySelection(selection);
  }

  private async autoCopySelection(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        this.overlayAddon.showOverlay('\u2702', 300);
        return;
      } catch { /* fall through to execCommand */ }
    }

    let copied = false;
    try {
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } catch { /* ignore */ }
    this.overlayAddon.showOverlay(copied ? '\u2702' : 'Copy failed', copied ? 300 : 700);
  }

  /** Capture-phase paste listener: intercepts images from native paste events. */
  private registerNativePasteImageHandler(): void {
    const el = this.terminal?.element;
    if (!el) return;
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items;
      const itemTypes = items ? Array.from(items).map(it => it?.type ?? '(null)') : null;
      this.logger.debug('paste-event', { itemCount: items?.length ?? 0, itemTypes });
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob || blob.size === 0 || blob.size > MAX_PASTE_IMAGE_BYTES) {
          this.logger.warn('paste-image-skip', { type: item.type, blobNull: blob === null, blobSize: blob?.size ?? 0 });
          continue;
        }
        e.stopImmediatePropagation();
        e.preventDefault();
        this.logger.debug('paste-image-intercepted', { type: item.type, size: blob.size });
        void this.handleNativePasteImage(blob, item.type);
        return;
      }
      // No image found — check if clipboard was completely empty (likely paste permission denied on iOS)
      const hasText = e.clipboardData?.getData('text/plain') !== '';
      this.logger.debug('paste-no-image', { itemCount: items.length, itemTypes, hasText });
      if (items.length === 0 && !hasText) {
        this.overlayAddon?.showOverlay('Clipboard empty \u2014 allow access when prompted', 2000);
      }
    };
    el.addEventListener('paste', onPaste, { capture: true });
    this.registerTerminal({ dispose: () => el.removeEventListener('paste', onPaste, { capture: true }) });
  }

  /** Handle an image blob from a native paste event. */
  private async handleNativePasteImage(blob: Blob, mimeType: string): Promise<void> {
    const arrayBuffer = await blob.arrayBuffer();
    const requestId = this.sendClipboardImage(arrayBuffer, mimeType);
    if (requestId <= 0) {
      this.logger.warn('paste-image-send-failed', { mimeType, dataSize: arrayBuffer.byteLength });
      return;
    }
    this.overlayAddon?.showOverlay('Sending image\u2026', 1500);
    const { status, errorInfo } = await this.waitForClipboardImageAck(requestId, 5000);
    if (status === 0) {
      this.overlayAddon?.showOverlay('Image copied to server clipboard', 1500);
    } else if (status === 2) {
      this.overlayAddon?.showOverlay('Image saved, path typed', 1500);
    } else {
      this.overlayAddon?.showOverlay('Image paste failed', 700);
      this.callbacks.onImagePasteError?.(errorInfo ?? {});
    }
  }

  private sendClipboardImage(imageData: ArrayBuffer, mimeType: string): number {
    const { socket, textEncoder } = this;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.logger.warn('paste-image-socket-not-open', { readyState: socket?.readyState ?? -1 });
      return 0;
    }

    this.clipboardImageRequestId++;
    const requestId = this.clipboardImageRequestId;

    const mimeBytes = textEncoder.encode(mimeType);
    if (mimeBytes.length > 255) {
      this.logger.warn('paste-image-mime-too-long', { mimeType, mimeLen: mimeBytes.length });
      return 0;
    }

    const payload = new Uint8Array(1 + 4 + 1 + mimeBytes.length + imageData.byteLength);
    payload[0] = CMD_CLIPBOARD_IMAGE;
    const view = new DataView(payload.buffer);
    view.setUint32(1, requestId, false);
    payload[5] = mimeBytes.length;
    payload.set(mimeBytes, 6);
    payload.set(new Uint8Array(imageData), 6 + mimeBytes.length);
    socket.send(payload);

    return requestId;
  }

  private waitForClipboardImageAck(_requestId: number, timeoutMs: number): Promise<{ status: number; errorInfo?: ImagePasteErrorInfo }> {
    return new Promise<{ status: number; errorInfo?: ImagePasteErrorInfo }>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingClipboardImageResolve === resolveOnce) {
          this.pendingClipboardImageResolve = undefined;
        }
        this.logger.warn('paste-image-ack-timeout', { requestId: _requestId, timeoutMs });
        resolve({ status: 1 });
      }, timeoutMs);

      const resolveOnce = (result: { status: number; errorInfo?: ImagePasteErrorInfo }) => {
        clearTimeout(timer);
        this.pendingClipboardImageResolve = undefined;
        resolve(result);
      };

      this.pendingClipboardImageResolve = resolveOnce;
    });
  }

  private initListeners() {
    const { terminal, overlayAddon } = this;
    this.registerSocket(terminal.onData(data => this.sendData(data)));
    this.registerSocket(terminal.onBinary(data => this.sendData(Uint8Array.from(data, v => v.charCodeAt(0)))));
    this.registerSocket(terminal.onResize(({ cols, rows }) => {
      const msg = JSON.stringify({ columns: cols, rows });
      this.socket?.send(this.textEncoder.encode(Command.RESIZE_TERMINAL + msg));
      if (this.resizeOverlay) overlayAddon.showOverlay(`${cols}x${rows}`, 300);
    }));
  }


  private onSocketOpen() {
    this.logger.info('websocket opened');
    const { overlayAddon } = this;

    // Clear any lingering overlay (e.g. "Reconnecting..." from failed initial attempts)
    overlayAddon.hideOverlay();

    if (this.opened) {
      this.terminal.options.disableStdin = false;
      overlayAddon.showOverlay('Reconnected', 300);
    } else {
      this.opened = true;
    }

    this.doReconnect = this.autoReconnect;
    this.reconnectDelay = 0;

    // Defer fit + handshake to the next animation frame so the browser has
    // settled the flex layout (SoftkeyBar / ContainerPanel heights finalised).
    // The visual viewport height is synced directly before fitting because
    // the async visualViewport.resize event may not have fired yet after a
    // visibility change.
    this.pendingConnectRaf = requestAnimationFrame(() => {
      this.pendingConnectRaf = undefined;
      if (this.socket?.readyState !== WebSocket.OPEN) return;

      const { textEncoder, terminal, fitAddon } = this;

      // Sync visual viewport height before fitting. On mobile wake-from-
      // sleep the visualViewport.resize event (handled by App.tsx) may not
      // have fired yet, leaving document.documentElement.style.height stale.
      // Reading window.visualViewport.height is always synchronous.
      const vv = window.visualViewport;
      if (vv) {
        const h = `${Math.round(vv.height)}px`;
        document.documentElement.style.height = h;
        document.body.style.height = h;
      }
      fitAddon.fit();

      // Register listeners before the handshake so the onResize handler is
      // active if the post-RAF ResizeObserver fires a layout correction.
      this.initListeners();

      const handshake: Record<string, unknown> = {
        AuthToken: this.token,
        columns: terminal.cols,
        rows: terminal.rows,
      };
      if (this.options.sessionId) {
        handshake['sessionId'] = this.options.sessionId;
      }
      if (this.options.shellName) {
        handshake['shell'] = this.options.shellName;
      }
      handshake['scrollback'] = this.scrollback;
      if (this.imagePasteDir !== undefined) {
        handshake['imagePasteDir'] = this.imagePasteDir;
      }
      handshake['notificationMode'] = this.notificationMode;
      handshake['remoteEditor'] = this.remoteEditor;
      if (this.themeForeground) handshake['themeForeground'] = this.themeForeground;
      if (this.themeBackground) handshake['themeBackground'] = this.themeBackground;
      this.logger.info('handshake', { sessionId: this.options.sessionId ?? null, shell: this.options.shellName ?? null, columns: terminal.cols, rows: terminal.rows });
      this.socket?.send(textEncoder.encode(JSON.stringify(handshake)));

      terminal.focus();
    });
  }

  private scheduleReconnect() {
    this.reconnectDelay = Math.min(Math.max(this.reconnectDelay, 500) * 2, 10000);
    this.logger.info('reconnecting', { delay: this.reconnectDelay });
    setTimeout(() => this.refreshToken().then(() => this.connect()), this.reconnectDelay);
  }

  private registerWakeDetection() {
    const check = () => {
      if (this.socket?.readyState !== WebSocket.OPEN && this.doReconnect) {
        this.logger.info('stale connection, reconnecting');
        this.socket?.close();
      }
    };
    this.registerTerminal(addEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    }));
    this.registerTerminal(addEventListener(window, 'online', check));
  }

  /** Tear down GPU renderer after a debounce when the tab is hidden,
   *  restore the preferred renderer when visible. Registered in open()
   *  so it survives WebSocket reconnections. */
  private registerRendererVisibility() {
    this.registerTerminal(addEventListener(document, 'visibilitychange', () => {
      if (document.hidden) {
        if (this.preferredRendererType === 'dom') return;
        clearTimeout(this.rendererTeardownTimer);
        this.rendererTeardownTimer = setTimeout(() => {
          this.rendererTeardownTimer = undefined;
          this.applyRendererType('dom');
        }, RENDERER_TEARDOWN_DELAY_MS);
      } else {
        clearTimeout(this.rendererTeardownTimer);
        this.rendererTeardownTimer = undefined;
        this.applyRendererType(this.preferredRendererType);
        // Re-fit in case the renderer change altered cell dimensions
        // (DOM vs WebGL subpixel rounding). The ResizeObserver won't fire
        // because the container size didn't change — only cells did.
        this.fitAddon.fit();
      }
    }));
    this.registerTerminal({ dispose: () => { clearTimeout(this.rendererTeardownTimer); this.rendererTeardownTimer = undefined; } });
  }

  private onSocketClose(event: CloseEvent) {
    this.logger.setConnected(false);
    this.logger.info('websocket closed', { code: event.code });
    const { overlayAddon } = this;
    this.dispose();

    if (event.code === 4004) {
      // Requested session not found on server — delegate to UI for shell selection
      this.logger.info('session not found on server, showing session picker');
      this.options.sessionId = undefined;
      this.callbacks.onSessionNotFound?.();
      return;
    }

    if (event.code === 4001) {
      // Replaced by another connection or switching sessions — auto-reconnect
      this.logger.info('session switch, reconnecting');
      overlayAddon.showOverlay('Reconnecting...');
      this.refreshToken().then(() => this.connect());
      return;
    }

    if (event.code === 4003) {
      // Connection replaced by another client — do not reconnect
      this.logger.info('replaced by another client, showing closed dialog');
      this.callbacks.onConnectionClosed?.('replaced');
      return;
    }

    if (event.code === 4002) {
      // Process exited
      this.logger.info('session process exited', { sessionId: this.currentSessionId });
      overlayAddon.showOverlay('Process exited');
      if (this.currentSessionId) {
        this.callbacks.onSessionDied?.(this.currentSessionId);
      }
      return;
    }

    if (this.closeOnDisconnect) {
      this.logger.info('connection closed, closing window');
      window.close();
      // window.close() may be a no-op — show dialog as fallback
      setTimeout(() => this.callbacks.onConnectionClosed?.('closed'), 200);
      return;
    }

    if (this.doReconnect) {
      this.logger.info('connection lost, reconnecting');
      overlayAddon.showOverlay('Reconnecting...');
      this.scheduleReconnect();
    } else {
      this.logger.info('connection closed, showing closed dialog');
      this.callbacks.onConnectionClosed?.('closed');
    }
  }

  private onSocketData(event: MessageEvent) {
    const rawData = event.data as ArrayBuffer;
    const bytes = new Uint8Array(rawData);
    const cmd = bytes[0]!;

    this.callbacks.onBytesReceived?.(rawData.byteLength);

    if (cmd === CMD_RTT_REPORT && rawData.byteLength >= 3) {
      const dv = new DataView(rawData);
      this.callbacks.onRttReport?.(dv.getUint16(1, false));
      if (rawData.byteLength >= 4) {
        this.callbacks.onTargetFps?.(bytes[3]!);
      }
      return;
    }

    if (cmd === CMD_SESSION_ALERT && rawData.byteLength > 1) {
      const alertSessionId = this.textDecoder.decode(new Uint8Array(rawData, 1));
      this.callbacks.onSessionAlert?.(alertSessionId);
      return;
    }

    if (cmd === CMD_SESSION_NOTIFICATION && rawData.byteLength > 1) {
      const jsonStr = this.textDecoder.decode(new Uint8Array(rawData, 1));
      try {
        const parsed: unknown = JSON.parse(jsonStr);
        if (typeof parsed === 'object' && parsed !== null) {
          const r = parsed as Record<string, unknown>;
          if (typeof r['sessionId'] === 'string' && typeof r['title'] === 'string') {
            const sName = typeof r['sessionName'] === 'string' ? r['sessionName'] : '';
            const sShell = typeof r['sessionShell'] === 'string' ? r['sessionShell'] : '';
            this.callbacks.onSessionNotification?.(
              r['sessionId'],
              r['title'],
              typeof r['body'] === 'string' ? r['body'] : '',
              sName || sShell,
              typeof r['sessionTitle'] === 'string' ? r['sessionTitle'] : '',
            );
          }
        }
      } catch { this.logger.debug('SESSION_NOTIFICATION parse failed'); }
      return;
    }

    if (cmd === CMD_CLIPBOARD_IMAGE_ACK && rawData.byteLength >= 6) {
      const status = bytes[5]!;
      let errorInfo: ImagePasteErrorInfo | undefined;
      if (status === 1 && rawData.byteLength > 6) {
        try {
          const jsonStr = this.textDecoder.decode(new Uint8Array(rawData, 6));
          const parsed: unknown = JSON.parse(jsonStr);
          if (typeof parsed === 'object' && parsed !== null) {
            const r = parsed as Record<string, unknown>;
            errorInfo = {
              clipboardError: typeof r['clipboardError'] === 'string' ? r['clipboardError'] : undefined,
              fileError: typeof r['fileError'] === 'string' ? r['fileError'] : undefined,
              imagePasteDir: typeof r['imagePasteDir'] === 'string' ? r['imagePasteDir'] : undefined,
            };
          }
        } catch { this.logger.debug('CLIPBOARD_IMAGE_ACK parse failed'); }
      }
      this.pendingClipboardImageResolve?.({ status, errorInfo });
      return;
    }

    if (cmd === CMD_EDITOR_OPEN && rawData.byteLength > 1) {
      const jsonStr = this.textDecoder.decode(new Uint8Array(rawData, 1));
      try {
        const parsed: unknown = JSON.parse(jsonStr);
        if (typeof parsed === 'object' && parsed !== null) {
          const r = parsed as Record<string, unknown>;
          if (typeof r['filePath'] === 'string' && typeof r['content'] === 'string') {
            const contentType = typeof r['contentType'] === 'string' ? r['contentType'] : undefined;
            this.callbacks.onEditorOpen?.(r['filePath'], r['content'], contentType);
          }
        }
      } catch { this.logger.debug('EDITOR_OPEN parse failed'); }
      return;
    }

    if (cmd === CMD_DOWNLOAD_START && rawData.byteLength > 1) {
      const jsonStr = this.textDecoder.decode(new Uint8Array(rawData, 1));
      try {
        const parsed: unknown = JSON.parse(jsonStr);
        if (typeof parsed === 'object' && parsed !== null) {
          const r = parsed as Record<string, unknown>;
          if (typeof r['fileName'] === 'string' && typeof r['fileSize'] === 'number' && typeof r['token'] === 'string') {
            this.callbacks.onDownloadStart?.(r['fileName'], r['fileSize'], r['token']);
          }
        }
      } catch { this.logger.debug('DOWNLOAD_START parse failed'); }
      return;
    }

    const cmdChar = String.fromCharCode(cmd);
    const payload = new Uint8Array(rawData, 1);

    switch (cmdChar) {
      case Command.STATE_FULL: {
        const distFromBottom = this.terminal.buffer.active.baseY - this.terminal.buffer.active.viewportY;
        const bufferTypeBefore = this.terminal.buffer.active.type;
        // Exit alternate buffer (no-op if already normal) before clearing scrollback,
        // so \x1b[3J operates on the normal buffer where scrollback lives.
        // The payload re-enters alternate mode if needed via \x1b[?1049h.
        const exitAlt = new Uint8Array([0x1b, 0x5b, 0x3f, 0x31, 0x30, 0x34, 0x39, 0x6c]); // \x1b[?1049l
        const clearScrollback = new Uint8Array([0x1b, 0x5b, 0x33, 0x4a]); // \x1b[3J
        const combined = new Uint8Array(exitAlt.length + clearScrollback.length + payload.length);
        combined.set(exitAlt);
        combined.set(clearScrollback, exitAlt.length);
        combined.set(payload, exitAlt.length + clearScrollback.length);
        this.terminal.write(combined, () => {
          const target = this.terminal.buffer.active.baseY - distFromBottom;
          this.terminal.scrollToLine(Math.max(0, target));
          this.logger.debug('state-full-applied', {
            baseY: this.terminal.buffer.active.baseY,
            viewportY: this.terminal.buffer.active.viewportY,
            bufferLength: this.terminal.buffer.active.length,
            bufferType: this.terminal.buffer.active.type,
            bufferTypeBefore,
            payloadSize: payload.length,
            scrollbackOption: this.terminal.options.scrollback,
            rows: this.terminal.rows,
          });
        });
        break;
      }
      case Command.STATE_UPDATE:
        this.terminal.write(payload);
        break;
      case Command.SET_WINDOW_TITLE:
        this.title = this.textDecoder.decode(payload);
        document.title = this.title;
        this.callbacks.onTitleChange?.(this.title);
        break;
      case Command.SET_PREFERENCES:
        this.applyPreferences({
          ...this.options.clientOptions,
          ...JSON.parse(this.textDecoder.decode(payload)),
        } as ClientOptions);
        break;
      case Command.SET_SESSION_INFO: {
        const info = JSON.parse(this.textDecoder.decode(payload)) as SessionInfo;
        this.currentSessionId = info.sessionId;
        this.options.sessionId = info.sessionId;
        this.logger.setSession(info.sessionId);
        this.logger.setConnected(true);
        this.callbacks.onSessionInfo?.(info);
        break;
      }
      default:
        this.logger.warn('unknown command', { cmd: cmd.toString(16) });
        break;
    }
  }

  private applyPreferences(prefs: ClientOptions) {
    const { terminal, fitAddon } = this;
    let needsFit = false;

    for (const [key, value] of Object.entries(prefs)) {
      switch (key) {
        case 'rendererType': this.setRendererType(value as RendererType); break;

        case 'disableResizeOverlay':
          if (value) this.resizeOverlay = false;
          break;
        case 'disableReconnect':
          if (value) { this.autoReconnect = false; this.doReconnect = false; }
          break;
        case 'closeOnDisconnect':
          if (value) { this.closeOnDisconnect = true; this.autoReconnect = false; this.doReconnect = false; }
          break;
        case 'titleFixed':
          if (value && value !== '') { this.titleFixed = value as string; document.title = this.titleFixed; }
          break;
        case 'isWindows': break;
        case 'enableSixel': break;
        case 'unicodeVersion': break;
        default:
          if ((terminal.options as Record<string, unknown>)[key] instanceof Object) {
            (terminal.options as Record<string, unknown>)[key] = Object.assign(
              {},
              (terminal.options as Record<string, unknown>)[key],
              value
            );
          } else {
            (terminal.options as Record<string, unknown>)[key] = value;
          }
          if (key.indexOf('font') === 0 || key === 'lineHeight' || key === 'letterSpacing') needsFit = true;
          break;
      }
    }

    this.syncPageBackground();
    if (needsFit) fitAddon.fit();
  }

  private setRendererType(value: RendererType) {
    this.preferredRendererType = value;
    // Don't load a GPU renderer while backgrounded — it will be restored
    // when the tab becomes visible (see registerRendererVisibility).
    if (document.hidden && value !== 'dom') return;
    this.applyRendererType(value);
  }

  private applyRendererType(value: RendererType) {
    const { terminal } = this;
    const disposeCanvas = () => { try { this.canvasAddon?.dispose(); } catch { /* */ } this.canvasAddon = undefined; };
    const disposeWebgl = () => { try { this.webglAddon?.dispose(); } catch { /* */ } this.webglAddon = undefined; };
    const enableCanvas = () => {
      if (this.canvasAddon) return;
      this.canvasAddon = new CanvasAddon();
      disposeWebgl();
      try { terminal.loadAddon(this.canvasAddon); } catch { this.logger.warn('canvas renderer failed, falling back to DOM'); disposeCanvas(); }
    };
    const enableWebgl = () => {
      if (this.webglAddon) return;
      this.webglAddon = new WebglAddon();
      disposeCanvas();
      try {
        this.webglAddon.onContextLoss(() => { this.webglAddon?.dispose(); });
        terminal.loadAddon(this.webglAddon);
      } catch { this.logger.warn('webgl renderer failed, falling back to canvas'); disposeWebgl(); enableCanvas(); }
    };

    switch (value) {
      case 'canvas': enableCanvas(); break;
      case 'webgl': enableWebgl(); break;
      case 'dom': disposeWebgl(); disposeCanvas(); break;
    }
  }

  // --- Modifier/key encoding ---

  private applyModifierToText(data: string): string {
    if (!data || data.length === 0) return data;
    const modifiers = this.modifierSource?.consumeModifiers();
    if (!modifiers || (!modifiers.ctrl && !modifiers.alt && !modifiers.shift)) return data;

    const chars = Array.from(data);
    const first = chars.shift();
    if (!first) return data;
    return this.encodeCharWithModifiers(first, modifiers) + chars.join('');
  }

  private encodeCharWithModifiers(char: string, modifiers: ModifierFlags): string {
    let value = modifiers.shift ? this.applyShift(char) : char;
    if (modifiers.ctrl) value = this.applyCtrl(value);
    if (modifiers.alt) value = `\x1b${value}`;
    return value;
  }

  private applyShift(char: string): string {
    if (/^[a-z]$/.test(char)) return char.toUpperCase();
    return char;
  }

  private applyCtrl(char: string): string {
    if (char.length !== 1) return char;
    const code = char.charCodeAt(0);
    if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
    if (code >= 65 && code <= 90) return String.fromCharCode(code - 64);
    switch (char) {
      case ' ': case '@': return String.fromCharCode(0);
      case '[': return String.fromCharCode(27);
      case '\\': return String.fromCharCode(28);
      case ']': return String.fromCharCode(29);
      case '^': return String.fromCharCode(30);
      case '_': return String.fromCharCode(31);
      case '?': return String.fromCharCode(127);
      default: return char;
    }
  }

  private hasModifiers(modifiers: ModifierFlags): boolean {
    return modifiers.ctrl || modifiers.alt || modifiers.shift;
  }

  private getCsiModifier(modifiers: ModifierFlags): number {
    return 1 + (modifiers.shift ? 1 : 0) + (modifiers.alt ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
  }

  private inApplicationCursorKeysMode(): boolean {
    return (this.terminal as Terminal & { modes?: { applicationCursorKeysMode?: boolean } })?.modes?.applicationCursorKeysMode ?? false;
  }

  private sendVirtualKey(key: VirtualKey, modifiers: ModifierFlags) {
    const appMode = this.inApplicationCursorKeysMode();
    if (!this.hasModifiers(modifiers)) {
      const keyMap: Record<string, string> = {
        esc: '\x1b', tab: '\t',
        up: appMode ? '\x1bOA' : '\x1b[A',
        down: appMode ? '\x1bOB' : '\x1b[B',
        right: appMode ? '\x1bOC' : '\x1b[C',
        left: appMode ? '\x1bOD' : '\x1b[D',
        home: appMode ? '\x1bOH' : '\x1b[H',
        end: appMode ? '\x1bOF' : '\x1b[F',
        pageup: '\x1b[5~', pagedown: '\x1b[6~',
      };
      const seq = keyMap[key];
      if (seq) this.sendData(seq);
      return;
    }

    const m = this.getCsiModifier(modifiers);
    const modKeyMap: Record<string, string> = {
      esc: this.encodeCharWithModifiers('\x1b', modifiers),
      tab: modifiers.shift && !modifiers.ctrl && !modifiers.alt ? '\x1b[Z' : `\x1b[1;${m}I`,
      up: `\x1b[1;${m}A`, down: `\x1b[1;${m}B`,
      right: `\x1b[1;${m}C`, left: `\x1b[1;${m}D`,
      home: `\x1b[1;${m}H`, end: `\x1b[1;${m}F`,
      pageup: `\x1b[5;${m}~`, pagedown: `\x1b[6;${m}~`,
    };
    const seq = modKeyMap[key];
    if (seq) this.sendData(seq);
  }

  private sendDynamicChar(char: string, modifiers: ModifierFlags) {
    if (!char || char.length === 0) return;
    if (!this.hasModifiers(modifiers)) { this.sendData(char); return; }
    this.sendData(this.encodeCharWithModifiers(char, modifiers));
  }

  private sendDynamicCombo(combo: ComboStep[]) {
    if (!Array.isArray(combo) || combo.length === 0) return;
    for (const step of combo) {
      if (step.kind === 'virtual') this.sendVirtualKey(step.key, step.modifiers);
      else if (step.kind === 'char') this.sendDynamicChar(step.char, step.modifiers);
    }
  }

  private sendVirtualWheelStep(direction: 1 | -1) {
    const element = this.terminal?.element;
    if (!element) return;
    const keyId = direction === -1 ? 'wheel_up' : 'wheel_down';
    const delta = this.softkeySettings[keyId]?.wheelDelta;
    if (delta === undefined) return;
    this.sendWheelDelta(direction * delta);
  }

  /** Dispatch a raw WheelEvent with the given deltaY (pixels). */
  private sendWheelDelta(deltaY: number) {
    const element = this.terminal?.element;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaMode: 0, deltaX: 0, deltaY,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    }));
  }

  /** Returns the set of swipe gesture IDs that map to wheel-step behavior. */
  private computeContinuousScrollGestures(): ReadonlySet<string> {
    const set = new Set<string>();
    for (const fingers of [1, 2, 3] as const) {
      for (const dir of ['up', 'down'] as const) {
        const gestureId: GestureId = `swipe-${fingers}-${dir}`;
        const keyId = this.gestureMapping[gestureId];
        if (!keyId) continue;
        const spec = getKeySpec(keyId, this.customKeyMap);
        if (spec.behavior.kind === 'wheel-step') set.add(gestureId);
      }
    }
    return set;
  }
}
