// Imperative terminal core — WebSocket, flow control, escape encoding, key dispatch.
// No React, no DOM creation. Receives a container element and manages xterm.js.

import type { IDisposable, ITerminalOptions } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { OverlayAddon } from './overlay';
import { SelectionOverlayAddon } from './selection-overlay';
import type { Profile, ProfileTheme, SoftkeyKeySettings } from './profiles';
import type { KeyBehavior, ModifierFlags, VirtualKey, ComboStep, KeySpec } from './softkey-types';
import { getKeySpec, emptyModifiers, parseComboString, matchComboEvent } from './softkey-types';
import { detectOS, resolveHotkey } from './platform-detect';
import type { GestureId, GestureMapping } from './gesture-types';
import { DEFAULT_GESTURE_MAPPING } from './gesture-types';
import { GestureDetector } from './gesture-detector';
import {
  decayVelocity, composeFlickVelocity,
  MOMENTUM_DECAY_RATE, MOMENTUM_FRAME_MS, MOMENTUM_EPSILON, MIN_FLICK_VELOCITY,
} from './scroll-momentum';
import { ClientLogger } from './client-logger';
import type { SessionInfo } from './sessions';
import { findFontOption, loadFont } from './fonts';
import { openExternalUrl } from './open-external-url';
import { getNativeBridge } from './native-bridge';

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

// Cap on the *decoded* OSC 52 payload. xterm.js's parser already limits
// the raw OSC payload to 10 MB; we cap lower so a runaway TUI can't trash
// the user's clipboard with a multi-MB blob. 1 MB covers any realistic
// editor yank.
const OSC52_MAX_DECODED_BYTES = 1024 * 1024; // 1 MB

const RENDERER_TEARDOWN_DELAY_MS = 5000;

/** Max time for a WebSocket to reach OPEN before we close and retry.
 *  Mobile radios can take 10-20s to power up after phone wake;
 *  TCP SYN timeout is 30-120s. 10s lets us retry faster. */
const CONNECT_TIMEOUT_MS = 10_000;

/** How long a connect / reconnect attempt may stay in-flight before we
 *  surface the "Things to check" overlay (VPN, server, host awake). */
const SLOW_CONNECT_MS = 2_000;

/** Client-side liveness: close the socket if no data arrives for this
 *  long while readyState is OPEN.  Server sends RTT_REPORT every 5s
 *  via heartbeat; 20s = 4 missed cycles. */
const LIVENESS_TIMEOUT_MS = 20_000;

/** How often to run the liveness check. */
const LIVENESS_CHECK_MS = 5_000;

/** Delay before disconnecting the WebSocket when the tab is hidden.
 *  Eliminates all network activity (server pings, sync frames) for
 *  backgrounded tabs.  Reconnects on visibilitychange → visible. */
const IDLE_DISCONNECT_DELAY_MS = 30_000;

const Command = {
  SET_WINDOW_TITLE: '1',
  SET_PREFERENCES: '2',
  SET_SESSION_INFO: '3',
  STATE_UPDATE: '4',
  STATE_FULL: '5',
  INPUT: '0',
  RESIZE_TERMINAL: '1',
} as const;

type RendererType = 'dom' | 'webgl';

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

export interface TerminalDiagnostics {
  renderer: 'webgl' | 'dom';
  rows: number;
  cols: number;
  baseY: number;
  viewportY: number;
  bufferLength: number;
  scrollback: number;
}

export interface TerminalCoreCallbacks {
  onTitleChange?: (title: string) => void;
  onSessionInfo?: (info: SessionInfo) => void;
  onSessionDied?: (sessionId: string) => void;
  onSessionNotFound?: () => void;
  onConnectionClosed?: (reason: ConnectionClosedReason) => void;
  /** Connect / reconnect has been pending long enough that we should warn
   *  the user to check VPN / server / host. Cleared via onConnected. */
  onConnectingSlow?: () => void;
  /** Socket reached OPEN; pair with `onConnectingSlow` to hide the overlay. */
  onConnected?: () => void;
  onRttReport?: (rttMs: number) => void;
  onBytesSent?: (bytes: number) => void;
  onBytesReceived?: (bytes: number) => void;
  onTargetFps?: (fps: number) => void;
  onSessionAlert?: (sessionId: string) => void;
  onSessionNotification?: (sessionId: string, title: string, body: string, sessionName: string, sessionTitle: string, sessionCwd: string) => void;
  onImagePasteError?: (error: ImagePasteErrorInfo) => void;
  onEditorOpen?: (filePath: string, content: string, contentType?: string) => void;
  onDownloadStart?: (fileName: string, fileSize: number, token: string) => void;
}

export interface TerminalCoreOptions {
  wsUrl: string;
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
  private socketDisposables: IDisposable[] = [];

  // Cleared only on full unmount (destroy()) — terminal-element-scoped resources belong here.
  private terminalDisposables: IDisposable[] = [];
  private textEncoder = new TextEncoder();
  private textDecoder = new TextDecoder();
  private singleCharBuf = new Uint8Array(2);

  private terminal!: Terminal;
  private fitAddon = new FitAddon();
  private overlayAddon = new OverlayAddon();
  private selectionOverlay?: SelectionOverlayAddon;
  private webLinksAddon = new WebLinksAddon((_event, uri) => {
    openExternalUrl(uri);
  });
  private webglAddon?: WebglAddon;
  private pendingAtlasSerial = 0;

  private socket?: WebSocket;
  private opened = false;
  private title?: string;
  private titleFixed?: string;
  private resizeOverlay = true;
  private autoReconnect = true;
  private doReconnect = true;
  private closeOnDisconnect = false;
  private reconnectDelay = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private slowConnectTimer?: ReturnType<typeof setTimeout>;
  private slowConnectReported = false;
  private lastMessageAt = 0;
  private gestureDetector?: GestureDetector;
  private lastGestureCenter: { x: number; y: number } = { x: 0, y: 0 };
  private panScrollAccumulator = 0;
  private panScrollLastTime = 0;
  private momentumVelocity = 0;         // px/ms, signed (same convention as sendPanScroll deltaY)
  private momentumRAF?: number;
  private momentumLastFrameTime = 0;
  // Two-stage residual tracking so multi-touch doesn't clobber an in-flight pan's
  // carried velocity: onTouchStart parks into pausedMomentum, onPanScrollBegin
  // promotes it to carriedResidual (safe from further onTouchStart overwrites),
  // onPanScrollEnd consumes carriedResidual.  Stale pausedMomentum from a tap
  // (no pan followed) is overwritten on the next onTouchStart.
  private pausedMomentum = 0;
  private carriedResidual = 0;
  private gestureMapping: GestureMapping = DEFAULT_GESTURE_MAPPING;
  private customKeyMap?: Map<string, KeySpec>;
  private clipboardImageRequestId = 0;
  private pendingClipboardImageResolve?: (result: { status: number; errorInfo?: ImagePasteErrorInfo }) => void;

  private modifierSource?: ModifierSource;
  private logger: ClientLogger;
  callbacks: TerminalCoreCallbacks = {};

  get clientLogger(): ClientLogger { return this.logger; }

  private currentSessionId?: string;
  private scrollPositions = new Map<string, number>();   // sessionId → distFromBottom at last switch-out
  private lastConnectedSessionId: string | null = null;  // sessionId whose content the buffer currently holds
  private softkeySettings: Record<string, SoftkeyKeySettings> = {};
  private scrollback: number;
  private imagePasteDir?: string;
  private notificationMode: 'iterm' | 'kitty' | 'ghostty' | 'off' = 'ghostty';
  private remoteEditor = false;
  private copyOnSelect = false;
  private copyCombo: ComboStep | null = null;
  private pasteCombo: ComboStep | null = null;
  private themeForeground?: string;
  private themeBackground?: string;
  private preferredRendererType: RendererType = 'dom';
  private rendererTeardownTimer?: ReturnType<typeof setTimeout>;
  private idleDisconnectTimer?: ReturnType<typeof setTimeout>;
  private idleDisconnected = false;
  private pendingConnectRaf?: number;
  private lastBlurWasInternal = false;

  constructor(private options: TerminalCoreOptions) {
    this.scrollback = this.options.termOptions.scrollback ?? 5000;
    this.logger = new ClientLogger({
      sendToServer: (payload) => { try { this.socket?.send(payload); } catch { /* socket may be closing */ } },
    });
    this.terminalDisposables.push({ dispose: () => this.logger.dispose() });
  }

  dispose() {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.connectTimer !== undefined) {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
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
    if (this.slowConnectTimer !== undefined) {
      clearTimeout(this.slowConnectTimer);
      this.slowConnectTimer = undefined;
    }
    this.slowConnectReported = false;
    this.stopMomentum();
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

  getDiagnostics(): TerminalDiagnostics {
    const buf = this.terminal.buffer.active;
    return {
      renderer: this.webglAddon ? 'webgl' : 'dom',
      rows: this.terminal.rows,
      cols: this.terminal.cols,
      baseY: buf.baseY,
      viewportY: buf.viewportY,
      bufferLength: buf.length,
      scrollback: this.terminal.options.scrollback ?? this.scrollback,
    };
  }

  logDiagnostics(reason: string) {
    this.logger.debug('term-diag', { reason, ...this.getDiagnostics() });
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
    this.registerOsc52Handler();
    this.syncPageBackground();
    fitAddon.fit();

    const observer = new ResizeObserver(() => {
      if (document.hidden) return;
      this.fitAddon.fit();
    });
    observer.observe(parent);
    this.registerTerminal({ dispose: () => observer.disconnect() });
    this.registerRendererVisibility();
    this.registerGestureDetection();
    this.registerTerminal(terminal.onTitleChange(data => {
      if (data && data !== '' && !this.titleFixed) {
        this.title = data;
        document.title = data;
        this.callbacks.onTitleChange?.(data);
      }
    }));
    this.registerTerminal(terminal.onSelectionChange(() => this.onSelectionChange()));
    this.registerWakeDetection();
    this.registerLivenessCheck();
    this.registerIdleDisconnect();
  }

  applyProfile(profile: Profile, themeColors?: ProfileTheme): void {
    const prevFontFamily = this.terminal.options.fontFamily;
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
    this.resolveHotkeysFromProfile(profile);
    this.syncPageBackground();
    this.fitAddon.fit();
    if (prevFontFamily !== profile.fontFamily) {
      this.logger.info('font-family-change', { from: prevFontFamily, ...this.getRenderDiagnostics('font-family-change') });
      void this.scheduleAtlasClear();
    }
  }

  connect() {
    // Cancel any pending reconnect timer to prevent duplicate connections
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    // Close any stale socket still in CONNECTING or OPEN state and
    // remove its event listeners so its async close event cannot
    // dispose the new socket's listeners (Layer 2 race prevention).
    const prev = this.socket;
    if (prev) {
      if (prev.readyState === WebSocket.CONNECTING || prev.readyState === WebSocket.OPEN) {
        prev.close();
      }
      this.dispose();
      this.socket = undefined;
    }

    this.socket = new WebSocket(this.options.wsUrl, ['tty']);
    const { socket } = this;

    socket.binaryType = 'arraybuffer';
    this.registerSocket(addEventListener(socket, 'open', () => this.onSocketOpen()));
    this.registerSocket(addEventListener(socket, 'message', (e) => this.onSocketData(e as MessageEvent)));
    this.registerSocket(addEventListener(socket, 'close', (e) => this.onSocketClose(e as CloseEvent)));

    // Start (or keep) the slow-connect timer so a stalled connect / a string
    // of failed reconnects surfaces the troubleshooting overlay after 2s.
    // Cleared only on a successful OPEN — re-entrant connects keep the
    // already-armed timer (or already-reported state) intact.
    if (!this.slowConnectReported && this.slowConnectTimer === undefined) {
      this.slowConnectTimer = setTimeout(() => {
        this.slowConnectTimer = undefined;
        this.slowConnectReported = true;
        this.callbacks.onConnectingSlow?.();
      }, SLOW_CONNECT_MS);
    }

    // Connection timeout: if the socket doesn't reach OPEN within the
    // deadline, close it.  The close event triggers scheduleReconnect().
    // `socket` is a local capture — safe even if connect() is called again.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = undefined;
      if (socket.readyState === WebSocket.CONNECTING) {
        this.logger.warn('connect timeout');
        socket.close();
      }
    }, CONNECT_TIMEOUT_MS);
  }

  /** Manual reconnect — called by the React UI when user clicks Reconnect. */
  reconnect() {
    this.logger.info('manual reconnect');
    this.doReconnect = true;
    this.reconnectDelay = 0;
    this.idleDisconnected = false;
    this.connect();
  }

  focus() {
    this.terminal?.focus();
  }

  switchSession(sessionId: string, shellName?: string) {
    this.logger.info('switching session', { sessionId: sessionId || null, shell: shellName ?? null });
    const outgoing = this.options.sessionId;
    if (outgoing && this.terminal) {
      const buf = this.terminal.buffer.active;
      const dist = buf.baseY - buf.viewportY;
      this.scrollPositions.set(outgoing, dist);
      this.logger.debug('scroll-saved', { sessionId: outgoing, dist });
    }
    this.logger.setSession(sessionId || null);
    this.options.sessionId = sessionId;
    this.options.shellName = shellName;
    this.doReconnect = true;
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      this.socket.close(4001, 'Switching session');
    } else {
      // Socket already closed (e.g. process exited) — connect directly
      this.connect();
    }
  }

  sendData(data: string | Uint8Array) {
    const { socket } = this;
    if (socket?.readyState !== WebSocket.OPEN) return;

    if (typeof data === 'string') {
      // Suppress focus reporting sequences from internal UI focus transitions.
      // When focus moves within the page (terminal → batch input, dialog, etc.),
      // document.hasFocus() stays true.  When focus leaves the page (tab switch),
      // it becomes false.  Drop the internal pairs so shells like sh/dash don't
      // echo ^[[O^[[I garbage when mode 1004 is active.
      if (data === '\x1b[O') {
        if (document.hasFocus()) { this.lastBlurWasInternal = true; return; }
        this.lastBlurWasInternal = false;
      } else if (data === '\x1b[I') {
        if (this.lastBlurWasInternal) { this.lastBlurWasInternal = false; return; }
      }

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
    // Native iOS bridge takes precedence: WKWebView denies cross-app
    // navigator.clipboard reads, so we route through UIPasteboard on the
    // Swift side. On non-iOS or older iOS shells the bridge is absent and
    // this branch is skipped entirely.
    const bridge = getNativeBridge();
    if (bridge?.readClipboard) {
      try {
        const r = await bridge.readClipboard();
        // r === null means the reply handler isn't registered on this
        // iOS shell — fall through to browser paths. Any non-null reply
        // (including {} on empty pasteboard or user-denied prompt) is
        // authoritative; navigator.clipboard would only throw and
        // surface a misleading error dialog.
        if (r !== null) {
          if (r.image) {
            const bytes = Uint8Array.from(atob(r.image.base64), c => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: r.image.mimeType });
            if (blob.size > 0 && blob.size <= MAX_PASTE_IMAGE_BYTES) {
              void this.handleNativePasteImage(blob, r.image.mimeType);
              return;
            }
          }
          if (r.text && r.text !== '') {
            this.handleBatchInput(r.text);
            return;
          }
          this.overlayAddon?.showOverlay('Clipboard empty', 700);
          this.keepTerminalFocus();
          return;
        }
      } catch { /* bridge errored — fall through to browser paths */ }
    }
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
      onPanScroll: (deltaY) => {
        this.sendPanScroll(deltaY);
      },
      onPanScrollBegin: () => {
        this.onPanScrollBegin();
      },
      onPanScrollEnd: (v) => {
        this.onPanScrollEnd(v);
      },
      onTouchStart: () => {
        this.onTouchStartPause();
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

  /** Sample first N and last N buffer lines for diagnostic logging. */
  private sampleBufferLines(n: number): { first: string[]; last: string[] } {
    const buf = this.terminal.buffer.active;
    const total = buf.length;
    const first: string[] = [];
    const last: string[] = [];
    for (let i = 0; i < Math.min(n, total); i++) {
      const line = buf.getLine(i);
      first.push(line ? line.translateToString(true).slice(0, 40) : '');
    }
    for (let i = Math.max(0, total - n); i < total; i++) {
      const line = buf.getLine(i);
      last.push(line ? line.translateToString(true).slice(0, 40) : '');
    }
    return { first, last };
  }

  // Count wrapped vs full-width-non-wrapped rows. fullWidthNonWrappedLines is
  // the diagnostic for content that grow-reflow can't merge — see
  // todo-bug-claude-code-line-wrap.md.
  private bufferWrapStats(): { bufferLen: number; cols: number; wrappedLines: number; fullWidthNonWrappedLines: number } {
    const buf = this.terminal.buffer.active;
    const cols = this.terminal.cols;
    let wrapped = 0;
    let fullNonWrapped = 0;
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      if (line.isWrapped) {
        wrapped++;
      } else if (line.translateToString(true).length === cols) {
        fullNonWrapped++;
      }
    }
    return { bufferLen: buf.length, cols, wrappedLines: wrapped, fullWidthNonWrappedLines: fullNonWrapped };
  }

  // Mirror of server-side detectLineRepetition (diff.ts). Scans the
  // entire buffer for repeated content-rich lines — corruption can
  // sit deep in scrollback (todo-bug-resize-induced-terminal-corruption.md).
  // Only call from low-frequency events.
  private bufferRepetitionStats(): { scannedRows: number; consideredRows: number; duplicateRows: number; topGroups: Array<{ sample: string; count: number }> } {
    const buf = this.terminal.buffer.active;
    const total = buf.length;
    const counts = new Map<string, { count: number; sample: string }>();
    let considered = 0;
    for (let y = 0; y < total; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (text.length < 10) continue;
      const distinct = new Set<string>();
      for (let i = 0; i < text.length; i++) distinct.add(text[i]!);
      if (distinct.size < 5) continue;
      considered++;
      const entry = counts.get(text);
      if (entry) entry.count++;
      else counts.set(text, { count: 1, sample: text.slice(0, 60) });
    }
    let duplicateRows = 0;
    const groups: Array<{ sample: string; count: number }> = [];
    for (const { count, sample } of counts.values()) {
      if (count < 2) continue;
      duplicateRows += count - 1;
      groups.push({ sample, count });
    }
    groups.sort((a, b) => b.count - a.count);
    return { scannedRows: total, consideredRows: considered, duplicateRows, topGroups: groups.slice(0, 5) };
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

  private resolveHotkeysFromProfile(profile: Profile): void {
    const os = detectOS();
    const copyStr = resolveHotkey(profile.copyHotkey, 'copy', os);
    const pasteStr = resolveHotkey(profile.pasteHotkey, 'paste', os);
    this.copyCombo = copyStr === null ? null : parseComboString(copyStr);
    this.pasteCombo = pasteStr === null ? null : parseComboString(pasteStr);
  }

  private registerKeyInterceptor() {
    this.terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      // Cmd-bearing keystrokes always pass through to xterm/native handling.
      if (event.metaKey) return true;

      if (this.copyCombo !== null && matchComboEvent(this.copyCombo, event)) {
        const selection = this.terminal.getSelection();
        if (selection !== '') {
          event.preventDefault();
          void this.autoCopySelection(selection);
          this.terminal.clearSelection();
          return false;
        }
        return true;
      }

      if (this.pasteCombo !== null && matchComboEvent(this.pasteCombo, event)) {
        // preventDefault stops the browser from also synthesizing a native paste
        // event for combos like Ctrl+Shift+V (which would double-fire via xterm's
        // built-in paste handler).
        event.preventDefault();
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

  // OSC 52: `ESC ] 52 ; <target> ; <base64> BEL` \u2014 a TUI inside the session
  // asks us to put text on the user's clipboard. See
  // docs/done-design-osc-52-copy.md for the design.
  private registerOsc52Handler(): void {
    const terminal = this.terminal;
    this.registerTerminal(terminal.parser.registerOscHandler(52, (data) => {
      const semi = data.indexOf(';');
      if (semi < 0) return true;
      const target = data.slice(0, semi);
      const payload = data.slice(semi + 1);
      // Targets: c=clipboard, p=primary, q=secondary, s=select. We map
      // c and s onto the system clipboard; ignore primary/secondary.
      // Empty target is also clipboard per the de-facto convention.
      if (target !== '' && !/[cs]/.test(target)) return true;
      // Query: `ESC ] 52 ; c ; ? BEL`. Refuse on privacy grounds \u2014 leaking
      // the user's clipboard to a remote app is the OSC 52 footgun we'd
      // rather not ship.
      if (payload === '?') {
        this.logger.debug('osc52-query-denied', {});
        return true;
      }
      // Empty payload would clear the clipboard. Silently ignore.
      if (payload === '') return true;
      let text: string;
      try {
        text = atob(payload);
      } catch {
        this.logger.warn('osc52-bad-base64', { length: payload.length });
        return true;
      }
      if (text.length > OSC52_MAX_DECODED_BYTES) {
        this.logger.warn('osc52-too-large', { length: text.length, cap: OSC52_MAX_DECODED_BYTES });
        this.overlayAddon?.showOverlay('Copy too large', 800);
        return true;
      }
      void this.writeClipboardFromTui(text);
      return true;
    }));
  }

  private async writeClipboardFromTui(text: string): Promise<void> {
    const bridge = getNativeBridge();
    if (bridge?.writeClipboard) {
      try {
        bridge.writeClipboard(text);
        this.overlayAddon?.showOverlay('Copied from session', 800);
        return;
      } catch (err) {
        this.logger.warn('osc52-bridge-write-failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        this.overlayAddon?.showOverlay('Copied from session', 800);
        return;
      } catch (err) {
        this.logger.warn('osc52-write-failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.overlayAddon?.showOverlay('Copy failed', 800);
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
      const stats = this.bufferWrapStats();
      this.logger.info('terminal resize', {
        cols, rows,
        bufferLen: stats.bufferLen,
        wrappedLines: stats.wrappedLines,
        fullWidthNonWrappedLines: stats.fullWidthNonWrappedLines,
        samples: this.sampleBufferLines(4),
        repeat: this.bufferRepetitionStats(),
      });
      const msg = JSON.stringify({ columns: cols, rows });
      this.socket?.send(this.textEncoder.encode(Command.RESIZE_TERMINAL + msg));
      if (this.resizeOverlay) overlayAddon.showOverlay(`${cols}x${rows}`, 300);
    }));
  }


  private onSocketOpen() {
    if (this.connectTimer !== undefined) {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
    if (this.slowConnectTimer !== undefined) {
      clearTimeout(this.slowConnectTimer);
      this.slowConnectTimer = undefined;
    }
    if (this.slowConnectReported) {
      this.slowConnectReported = false;
      this.callbacks.onConnected?.();
    }
    this.lastMessageAt = Date.now();
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, this.reconnectDelay);
  }

  private registerWakeDetection() {
    const check = () => {
      if (this.idleDisconnected) return;
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

  /** Periodic check for zombie sockets: readyState OPEN but no data
   *  received.  Terminal-scoped so it survives reconnections. */
  private registerLivenessCheck() {
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      if (this.lastMessageAt === 0) return;
      const elapsed = Date.now() - this.lastMessageAt;
      if (elapsed > LIVENESS_TIMEOUT_MS) {
        this.logger.warn('liveness timeout', { elapsed });
        this.socket.close();
      }
    }, LIVENESS_CHECK_MS);
    this.registerTerminal({ dispose: () => clearInterval(timer) });
  }

  /** Disconnect the WebSocket after a grace period when the tab is hidden.
   *  Eliminates all network activity for backgrounded tabs.
   *  Reconnects immediately on visibilitychange → visible.
   *  Terminal-scoped so it survives WebSocket reconnections. */
  private registerIdleDisconnect() {
    this.registerTerminal(addEventListener(document, 'visibilitychange', () => {
      if (document.hidden) {
        if (this.closeOnDisconnect || !this.autoReconnect) return;
        if (this.idleDisconnected) return;
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        clearTimeout(this.idleDisconnectTimer);
        this.idleDisconnectTimer = setTimeout(() => {
          this.idleDisconnectTimer = undefined;
          if (!document.hidden) return;
          if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
          this.idleDisconnected = true;
          this.logger.info('idle disconnect');
          this.socket.close();
        }, IDLE_DISCONNECT_DELAY_MS);
      } else {
        clearTimeout(this.idleDisconnectTimer);
        this.idleDisconnectTimer = undefined;
        if (this.idleDisconnected) {
          this.idleDisconnected = false;
          this.reconnectDelay = 0;
          this.logger.info('wake from idle, reconnecting');
          this.connect();
        }
      }
    }));
    this.registerTerminal({ dispose: () => { clearTimeout(this.idleDisconnectTimer); this.idleDisconnectTimer = undefined; } });
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
        // Re-fit: covers renderer cell-dimension changes (DOM vs WebGL
        // subpixel rounding) and any container resize that was deferred
        // by the ResizeObserver hidden guard.
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
      this.connect();
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

    if (this.idleDisconnected) {
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
    this.lastMessageAt = Date.now();
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
              typeof r['sessionCwd'] === 'string' ? r['sessionCwd'] : '',
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
        // Snapshot state BEFORE any pending WriteBuffer entries drain.
        // If these differ from the post-drain values, pending writes were
        // in-flight — a likely cause of stale distFromBottom.
        const preBaseY = this.terminal.buffer.active.baseY;
        const preViewportY = this.terminal.buffer.active.viewportY;
        const preLength = this.terminal.buffer.active.length;
        const bufferTypeBefore = this.terminal.buffer.active.type;

        // Flush pending WriteBuffer entries so distFromBottom reflects the
        // fully-processed state, not a stale intermediate.  When the tab is
        // hidden the browser throttles setTimeout, causing STATE_UPDATE
        // writes to pile up unprocessed.
        this.terminal.write('', () => {
          const drainedBaseY = this.terminal.buffer.active.baseY;
          const drainedViewportY = this.terminal.buffer.active.viewportY;
          const drainedLength = this.terminal.buffer.active.length;
          const hadPendingWrites = drainedBaseY !== preBaseY
            || drainedViewportY !== preViewportY
            || drainedLength !== preLength;
          // Cross-session switch must NOT read distFromBottom from the live buffer —
          // it still holds the outgoing session's content.  Use saved scroll for the
          // incoming session, fall back to buffer only on same-session reconnect.
          const incoming = this.options.sessionId;
          const saved = incoming ? this.scrollPositions.get(incoming) : undefined;
          const sameSessionReconnect = !!incoming && incoming === this.lastConnectedSessionId;
          let distFromBottom: number;
          let scrollSource: 'saved' | 'buffer' | 'default';
          if (saved !== undefined) {
            distFromBottom = saved;
            scrollSource = 'saved';
          } else if (sameSessionReconnect) {
            distFromBottom = drainedBaseY - drainedViewportY;
            scrollSource = 'buffer';
          } else {
            distFromBottom = 0;
            scrollSource = 'default';
          }

          // Sample first and last 3 lines of the pre-clear buffer for post-hoc
          // corruption diagnosis (text only, truncated to 40 chars).
          const preLines = this.sampleBufferLines(3);

          const modesBefore = {
            mouse: this.terminal.modes.mouseTrackingMode,
            paste: this.terminal.modes.bracketedPasteMode,
            focus: this.terminal.modes.sendFocusMode,
          };

          // Reset sticky DECSET modes that @xterm/addon-serialize never RESETs
          // (it only emits SET sequences for non-default modes). Without this,
          // a mode set by a previous session's TUI — github copilot enables
          // \x1b[?1000h mouse tracking, for example — survives session switches
          // because this Terminal instance is shared across sessions. The
          // snapshot's own SET sequences follow and re-enable whatever the new
          // session needs.
          //   1049 — alt buffer (must be first so \x1b[3J targets normal buffer)
          //   9, 1000, 1002, 1003 — mouse tracking protocols
          //   1004 — focus event reporting
          //   1005, 1006, 1015, 1016 — mouse coordinate encodings
          //   2004 — bracketed paste
          //   \x1b[3J — clear scrollback (last, on the normal buffer)
          // See docs/done-bug-mouse-mode-leak-on-session-switch.md.
          const prefix = this.textEncoder.encode(
            '\x1b[?1049l' +
            '\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l' +
            '\x1b[?1004l' +
            '\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l' +
            '\x1b[?2004l' +
            '\x1b[3J'
          );
          const combined = new Uint8Array(prefix.length + payload.length);
          combined.set(prefix);
          combined.set(payload, prefix.length);
          this.terminal.write(combined, () => {
            const postBaseY = this.terminal.buffer.active.baseY;
            const target = postBaseY - distFromBottom;
            this.terminal.scrollToLine(Math.max(0, target));
            this.lastConnectedSessionId = incoming || null;

            // Sample first and last 3 lines of the post-write buffer.
            const postLines = this.sampleBufferLines(3);

            const modesAfter = {
              mouse: this.terminal.modes.mouseTrackingMode,
              paste: this.terminal.modes.bracketedPasteMode,
              focus: this.terminal.modes.sendFocusMode,
            };
            this.logger.debug('state-full-applied', {
              preBaseY,
              preViewportY,
              preLength,
              drainedBaseY,
              drainedViewportY,
              drainedLength,
              hadPendingWrites,
              distFromBottom,
              scrollSource,
              postBaseY,
              target,
              viewportY: this.terminal.buffer.active.viewportY,
              bufferLength: this.terminal.buffer.active.length,
              bufferType: this.terminal.buffer.active.type,
              bufferTypeBefore,
              payloadSize: payload.length,
              modesBefore,
              modesAfter,
              scrollbackOption: this.terminal.options.scrollback,
              rows: this.terminal.rows,
              preLines,
              postLines,
              wrapStats: this.bufferWrapStats(),
              repeat: this.bufferRepetitionStats(),
            });
          });
        });
        break;
      }
      case Command.STATE_UPDATE:
        this.logger.debug('state-update', { len: payload.length });
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
        case 'rendererType': this.setRendererType(value === 'webgl' ? 'webgl' : 'dom'); break;

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
          if (key === 'fontFamily') void this.scheduleAtlasClear();
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
    const before: RendererType = this.webglAddon ? 'webgl' : 'dom';
    const disposeWebgl = () => { try { this.webglAddon?.dispose(); } catch { /* */ } this.webglAddon = undefined; };

    switch (value) {
      case 'webgl':
        if (this.webglAddon) return;
        this.webglAddon = new WebglAddon();
        try {
          this.webglAddon.onContextLoss(() => {
            this.logger.warn('webgl-context-loss', this.getRenderDiagnostics('context-loss'));
            this.webglAddon?.dispose();
            this.webglAddon = undefined;
          });
          terminal.loadAddon(this.webglAddon);
          void this.scheduleAtlasClear();
        } catch { this.logger.warn('webgl renderer failed, falling back to DOM'); disposeWebgl(); }
        break;
      case 'dom':
        disposeWebgl();
        break;
    }
    const after: RendererType = this.webglAddon ? 'webgl' : 'dom';
    if (before !== after) this.logger.info('renderer-change', { from: before, to: after, requested: value });
    this.logger.debug('renderer-applied', this.getRenderDiagnostics(value));
  }

  /** Capture renderer + font state for diagnosing font-rendering issues. */
  private getRenderDiagnostics(trigger: string): Record<string, unknown> {
    const el = this.terminal.element;
    const screenRaw = el?.querySelector('.xterm-screen');
    const screen = screenRaw instanceof HTMLElement ? screenRaw : null;
    const canvases = el?.querySelectorAll('canvas') ?? [];
    const opt = this.terminal.options;
    const computed = screen ? getComputedStyle(screen) : null;
    const fontFamily = opt.fontFamily ?? '';
    const firstFontFace = fontFamily.match(/"([^"]+)"|'([^']+)'|([^,]+)/)?.[0]?.replace(/["']/g, '').trim() ?? '';
    let fontLoaded: boolean | string = 'unknown';
    try {
      if (firstFontFace && document.fonts) {
        fontLoaded = document.fonts.check(`${opt.fontSize ?? 14}px "${firstFontFace}"`);
      }
    } catch (e) { fontLoaded = e instanceof Error ? `error:${e.message}` : 'error'; }
    return {
      trigger,
      renderer: this.webglAddon ? 'webgl' : 'dom',
      preferred: this.preferredRendererType,
      canvasCount: canvases.length,
      fontFamily,
      fontSize: opt.fontSize ?? null,
      fontWeight: opt.fontWeight ?? null,
      fontWeightBold: opt.fontWeightBold ?? null,
      letterSpacing: opt.letterSpacing ?? null,
      lineHeight: opt.lineHeight ?? null,
      fontLoaded,
      fontsReadyStatus: document.fonts?.status ?? 'n/a',
      computedFontFamily: computed?.fontFamily ?? 'n/a',
      computedFontVariant: computed?.fontVariant ?? 'n/a',
      computedFontFeature: computed?.fontFeatureSettings ?? 'n/a',
      computedTextTransform: computed?.textTransform ?? 'n/a',
      dpr: window.devicePixelRatio,
      documentHidden: document.hidden,
      xtermClassList: el?.className ?? '',
    };
  }

  /**
   * Invalidate the WebGL glyph atlas once the current font face is decoded.
   * Handles post-mount font swaps (settings panel, server reconcile) and
   * WebGL recreate after context loss / visibility cycles.
   */
  private async scheduleAtlasClear(): Promise<void> {
    const serial = ++this.pendingAtlasSerial;
    if (!this.webglAddon) return;
    const opt = this.terminal.options;
    const fontFamily = opt.fontFamily ?? '';
    const firstFontFace = fontFamily.match(/"([^"]+)"|'([^']+)'|([^,]+)/)?.[0]?.replace(/["']/g, '').trim() ?? '';
    if (!firstFontFace) return;

    // Route known fonts through loadFont() — it awaits link.onload before
    // document.fonts.load(face). Calling document.fonts.load(face) directly
    // is the antipattern the gate fix removed: it resolves immediately with
    // zero matches when the @font-face rule isn't yet registered, misfiring
    // the atlas clear before the font is ready. loadFont() is idempotent —
    // reuses an existing <link> if one was already added.
    const fontOption = findFontOption(fontFamily);
    if (fontOption?.cssFile) {
      await loadFont(fontOption);
    } else {
      try { await document.fonts.load(`${opt.fontSize ?? 14}px "${firstFontFace}"`); } catch { /* swallow */ }
    }

    if (this.terminalDisposables.length === 0) return;
    if (this.pendingAtlasSerial !== serial) return;
    if (!this.webglAddon) return;
    this.webglAddon.clearTextureAtlas();
    // clearTextureAtlas() only wipes the cache; existing canvas pixels
    // were rasterized from the old (fallback) atlas and won't change
    // until cells redraw. Force a full refresh so every visible cell
    // re-bakes its glyph from the now-empty atlas using the loaded font.
    this.terminal.refresh(0, this.terminal.rows - 1);
    this.logger.info('webgl-atlas-rebaked', this.getRenderDiagnostics('atlas-rebake'));
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

  /**
   * 1:1 touch pan scroll. Converts pixel drag delta to integer row scroll via
   * a fractional accumulator — bypasses xterm's WheelEvent pipeline (which
   * damps synthetic pixel deltas to ~0.42x on Chrome).
   */
  private sendPanScroll(deltaY: number): void {
    this.applyPanDelta(deltaY, 200);
  }

  /**
   * Pixel→row converter shared by drag-driven (sendPanScroll) and inertia-driven
   * (tickMomentum) paths.  Returns `clamped: true` when rows were requested but
   * the viewport didn't move — used by momentum to stop at buffer edges.
   * `resetGapMs` is Infinity for the momentum path so 16ms frame gaps don't
   * trip the idle-reset intended for gesture-to-gesture transitions.
   */
  private applyPanDelta(deltaY: number, resetGapMs: number): { rowsApplied: number; clamped: boolean } {
    if (!this.terminal) return { rowsApplied: 0, clamped: false };
    // Alt buffer (vim, neovim, less, htop, …) has no scrollback — viewport
    // scroll is a no-op. Dispatch a WheelEvent so xterm.js can translate it
    // to mouse-button-4/5 (when the app enabled mouse tracking) or arrow-key
    // sequences (xterm's built-in fallback at !buffer.hasScrollback).
    // Both pan-drag and momentum-RAF paths funnel through here, so iOS-style
    // flick decay produces a tapering stream of wheel events naturally.
    if (this.terminal.buffer.active.type === 'alternate') {
      this.sendWheelDelta(deltaY);
      return { rowsApplied: 0, clamped: false };
    }
    const rowHeight = this.getRowHeight();
    if (!rowHeight) return { rowsApplied: 0, clamped: false };
    const now = performance.now();
    if (now - this.panScrollLastTime > resetGapMs) this.panScrollAccumulator = 0;
    this.panScrollLastTime = now;
    this.panScrollAccumulator += deltaY;
    const rows = Math.trunc(this.panScrollAccumulator / rowHeight);
    if (rows === 0) return { rowsApplied: 0, clamped: false };
    const before = this.terminal.buffer.active.viewportY;
    this.terminal.scrollLines(rows);
    this.panScrollAccumulator -= rows * rowHeight;
    const after = this.terminal.buffer.active.viewportY;
    return { rowsApplied: rows, clamped: before === after };
  }

  // --- iOS-style pan-scroll momentum ---

  private onTouchStartPause(): void {
    // Pause in-flight momentum; retain velocity for onPanScrollBegin to claim.
    // If the gesture is a tap (no pan follows), pausedMomentum is overwritten
    // on the next onTouchStart (stopMomentum returns 0 once already stopped).
    this.pausedMomentum = this.stopMomentum();
  }

  private onPanScrollBegin(): void {
    // Promote the paused velocity into this pan session's carried residual.
    // After this point, further onTouchStart (e.g. a 2nd finger added to the
    // ongoing pan) won't clobber carriedResidual — pausedMomentum is a separate
    // field that onTouchStart writes to instead.
    this.carriedResidual = this.pausedMomentum;
    this.pausedMomentum = 0;
  }

  private onPanScrollEnd(releaseVelocity: number): void {
    const v = composeFlickVelocity(this.carriedResidual, releaseVelocity, MIN_FLICK_VELOCITY);
    this.carriedResidual = 0;
    this.startMomentum(v);
  }

  private startMomentum(velocity: number): void {
    if (Math.abs(velocity) < MIN_FLICK_VELOCITY) return;
    if (this.momentumRAF !== undefined) cancelAnimationFrame(this.momentumRAF);
    this.momentumVelocity = velocity;
    this.momentumLastFrameTime = performance.now();
    // panScrollAccumulator is intentionally NOT reset — sub-row residual from
    // the drag rolls seamlessly into the inertial phase.
    this.momentumRAF = requestAnimationFrame(() => this.tickMomentum());
  }

  private tickMomentum(): void {
    this.momentumRAF = undefined;
    if (!this.terminal) { this.momentumVelocity = 0; return; }
    const now = performance.now();
    const dt = now - this.momentumLastFrameTime;
    this.momentumLastFrameTime = now;
    const { clamped } = this.applyPanDelta(this.momentumVelocity * dt, Infinity);
    if (clamped) { this.momentumVelocity = 0; return; }
    this.momentumVelocity = decayVelocity(this.momentumVelocity, dt, MOMENTUM_DECAY_RATE, MOMENTUM_FRAME_MS);
    if (Math.abs(this.momentumVelocity) < MOMENTUM_EPSILON) { this.momentumVelocity = 0; return; }
    this.momentumRAF = requestAnimationFrame(() => this.tickMomentum());
  }

  /** Cancels the RAF loop and returns the velocity at the moment of stop (for carried momentum). */
  private stopMomentum(): number {
    if (this.momentumRAF !== undefined) {
      cancelAnimationFrame(this.momentumRAF);
      this.momentumRAF = undefined;
    }
    const v = this.momentumVelocity;
    this.momentumVelocity = 0;
    return v;
  }

  private getRowHeight(): number {
    // .xterm-screen exists in all renderer modes (DOM, WebGL); .xterm-rows only
    // exists under the DOM renderer, so querying it would return null on WebGL
    // (the default) and break pan scroll.
    const screen = this.terminal?.element?.querySelector<HTMLElement>('.xterm-screen');
    const rows = this.terminal?.rows;
    if (!screen || !rows) return 0;
    return screen.clientHeight / rows;
  }

  /** Dispatch a raw WheelEvent with the given deltaY (pixels). */
  private sendWheelDelta(deltaY: number) {
    const element = this.terminal?.element;
    if (!element) return;
    // Dispatch on .xterm-screen so the event bubbles through xterm.js 6.0's
    // SmoothScrollableElement (which listens on its own DOM node, a parent
    // of .xterm-screen). Dispatching on the root .xterm element wouldn't
    // reach the scrollable element since events bubble up, not down.
    const target = element.querySelector('.xterm-screen') ?? element;
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new WheelEvent('wheel', {
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
