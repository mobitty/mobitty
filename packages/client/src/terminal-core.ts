// Imperative terminal core — WebSocket, flow control, escape encoding, key dispatch.
// No React, no DOM creation. Receives a container element and manages xterm.js.

import type { IDisposable, ITerminalOptions } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { OverlayAddon } from './overlay';
import type { Profile, ProfileTheme, SoftkeyKeySettings } from './profiles';
import type { KeyBehavior, ModifierFlags, VirtualKey, ComboStep, KeySpec } from './softkey-types';
import { getKeySpec, emptyModifiers } from './softkey-types';
import type { GestureId, GestureMapping } from './gesture-types';
import { DEFAULT_GESTURE_MAPPING } from './gesture-types';
import { GestureDetector } from './gesture-detector';
import { ClientLogger } from './client-logger';
import type { SessionInfo } from './sessions';
import {
  isStandaloneMode,
  hasDeferredInstallPrompt,
  triggerInstallPrompt,
  wasInstallHintShown,
  markInstallHintShown,
} from './pwa-install';

const CMD_CLIPBOARD_IMAGE = 0x36;
const CMD_CLIPBOARD_IMAGE_ACK = 0x36;
const CMD_RTT_REPORT = 0x37;
const CMD_SESSION_ALERT = 0x38;
const CMD_SESSION_NOTIFICATION = 0x3a;
const CMD_UPDATE_SETTINGS = 0x32;
const CMD_EDITOR_OPEN = 0x3b;
const CMD_EDITOR_DONE = 0x3a;

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
  disableLeaveAlert: boolean;
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

export interface TerminalCoreCallbacks {
  onTitleChange?: (title: string) => void;
  onSessionInfo?: (info: SessionInfo) => void;
  onSessionDied?: (sessionId: string) => void;
  onSessionNotFound?: () => void;
  onRttReport?: (rttMs: number) => void;
  onBytesSent?: (bytes: number) => void;
  onBytesReceived?: (bytes: number) => void;
  onTargetFps?: (fps: number) => void;
  onSessionAlert?: (sessionId: string) => void;
  onSessionNotification?: (sessionId: string, title: string, body: string, sessionName: string, sessionTitle: string) => void;
  onImagePasteError?: (error: ImagePasteErrorInfo) => void;
  onEditorOpen?: (filePath: string, content: string) => void;
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
  private disposables: IDisposable[] = [];
  private textEncoder = new TextEncoder();
  private textDecoder = new TextDecoder();
  private singleCharBuf = new Uint8Array(2);

  private terminal!: Terminal;
  private fitAddon = new FitAddon();
  private overlayAddon = new OverlayAddon();
  private webLinksAddon = new WebLinksAddon();
  private webglAddon?: WebglAddon;
  private canvasAddon?: CanvasAddon;

  private socket?: WebSocket;
  private token = '';
  private opened = false;
  private title?: string;
  private titleFixed?: string;
  private resizeOverlay = true;
  private reconnect = true;
  private doReconnect = true;
  private closeOnDisconnect = false;
  private reconnectDelay = 0;
  private reconnectKeyDisposable?: IDisposable;
  private parent?: HTMLElement;
  private gestureDetector?: GestureDetector;
  private gestureMapping: GestureMapping = DEFAULT_GESTURE_MAPPING;
  private customKeyMap?: Map<string, KeySpec>;
  private clipboardImageRequestId = 0;
  private pendingClipboardImageResolve?: (result: { status: number; errorInfo?: ImagePasteErrorInfo }) => void;

  private modifierSource?: ModifierSource;
  private logger?: ClientLogger;
  callbacks: TerminalCoreCallbacks = {};

  private currentSessionId?: string;
  private softkeySettings: Record<string, SoftkeyKeySettings> = {};
  private scrollback: number;
  private imagePasteDir?: string;
  private notificationMode: 'iterm' | 'kitty' | 'ghostty' | 'off' = 'iterm';
  private remoteEditor = false;
  private themeForeground?: string;
  private themeBackground?: string;
  private scrollbarHealthTimer?: ReturnType<typeof setInterval>;
  private scrollbarStuckCount = 0;

  constructor(private options: TerminalCoreOptions) {
    this.scrollback = this.options.termOptions.scrollback ?? 5000;
  }

  dispose() {
    this.stopScrollbarHealthCheck();
    this.reconnectKeyDisposable?.dispose();
    this.reconnectKeyDisposable = undefined;
    this.gestureDetector?.dispose();
    this.gestureDetector = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  private register<T extends IDisposable>(d: T): T {
    this.disposables.push(d);
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
      console.warn('[mobitty] fetch token failed');
    }
  }

  open(parent: HTMLElement) {
    this.parent = parent;
    this.terminal = new Terminal(this.options.termOptions);
    const { terminal, fitAddon, overlayAddon, webLinksAddon } = this;

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(overlayAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(parent);
    this.registerKeyInterceptor();
    this.registerNativePasteImageHandler();
    this.syncPageBackground();
    fitAddon.fit();
  }

  applyProfile(profile: Profile, themeColors?: ProfileTheme, isMobile?: boolean): void {
    const fontSize = isMobile ? profile.fontSize.mobile : profile.fontSize.desktop;
    this.options.termOptions.fontSize = fontSize;
    this.options.termOptions.fontFamily = profile.fontFamily;
    this.options.termOptions.scrollback = profile.scrollback;
    this.options.termOptions.macOptionIsMeta = profile.optionIsMeta;
    if (themeColors) {
      this.options.termOptions.theme = themeColors;
      this.themeForeground = themeColors.foreground;
      this.themeBackground = themeColors.background;
    }
    this.terminal.options.fontSize = fontSize;
    this.terminal.options.fontFamily = profile.fontFamily;
    this.terminal.options.scrollback = profile.scrollback;
    this.terminal.options.macOptionIsMeta = profile.optionIsMeta;
    this.scrollback = profile.scrollback;
    if (themeColors) {
      this.terminal.options.theme = { ...this.terminal.options.theme, ...themeColors };
    }
    this.syncPageBackground();
    this.fitAddon.fit();
  }

  connect() {
    this.socket = new WebSocket(this.options.wsUrl, ['tty']);
    const { socket } = this;

    socket.binaryType = 'arraybuffer';
    this.register(addEventListener(socket, 'open', () => this.onSocketOpen()));
    this.register(addEventListener(socket, 'message', (e) => this.onSocketData(e as MessageEvent)));
    this.register(addEventListener(socket, 'close', (e) => this.onSocketClose(e as CloseEvent)));
  }

  focus() {
    this.terminal?.focus();
  }

  switchSession(sessionId: string, shellName?: string) {
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
      this.logger?.warn('scrollbar-stuck-detected', {
        ...this.getScrollbarDiagnostics(),
        consecutiveCount: this.scrollbarStuckCount,
      });
      if (this.scrollbarStuckCount >= 2) {
        this.attemptScrollbarRecovery();
      }
    } else {
      if (this.scrollbarStuckCount > 0) {
        this.logger?.info('scrollbar-unstuck', {
          previousStuckCount: this.scrollbarStuckCount,
        });
      }
      this.scrollbarStuckCount = 0;
    }
  }

  private attemptScrollbarRecovery(): void {
    this.logger?.info('scrollbar-recovery-start', this.getScrollbarDiagnostics());
    const savedViewportY = this.terminal.buffer.active.viewportY;

    // Phase 1: Force render refresh + scroll poke
    this.terminal.refresh(0, this.terminal.rows - 1);
    this.terminal.scrollToBottom();
    requestAnimationFrame(() => {
      this.terminal.scrollToLine(savedViewportY);

      if (!this.isScrollbarStuck()) {
        this.logger?.info('scrollbar-recovery-success', { method: 'refresh-poke' });
        this.scrollbarStuckCount = 0;
        this.overlayAddon.showOverlay('Scroll fixed', 500);
        return;
      }

      // Phase 2: Clear scrollback separately, then request STATE_FULL
      this.logger?.info('scrollbar-recovery-escalating', { method: 'clear-then-state-full' });
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
      onGesture: (gestureId) => {
        const keyId = this.gestureMapping[gestureId];
        if (!keyId) return;
        const spec = getKeySpec(keyId, this.customKeyMap);
        this.dispatchKeyAction(spec.behavior, emptyModifiers());
      },
      onContinuousScroll: (deltaY) => {
        this.sendWheelDelta(deltaY);
      },
      onDoubleTapDefault: (clientX, clientY) => {
        this.dispatchTouchMultiClick(2, clientX, clientY);
      },
      onTripleTapDefault: (clientX, clientY) => {
        if (!this.modifierSource) {
          this.dispatchTouchMultiClick(3, clientX, clientY);
          return;
        }
        const selectVisible = this.modifierSource.consumeModifierForTapSelection('shift');
        const selectAll = this.modifierSource.consumeModifierForTapSelection('alt');
        if (selectVisible) {
          this.selectVisibleViewportLines();
        } else if (selectAll) {
          this.terminal?.selectAll();
        } else {
          this.dispatchTouchMultiClick(3, clientX, clientY);
        }
      },
    }, this.computeContinuousScrollGestures());
  }

  private selectVisibleViewportLines() {
    const terminal = this.terminal;
    if (!terminal) return;
    const start = Math.max(0, terminal.buffer.active.viewportY);
    const end = Math.min(terminal.buffer.active.length - 1, start + Math.max(1, terminal.rows) - 1);
    if (end < start) return;
    terminal.selectLines(start, end);
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

  // --- Browser hotkey capture ---

  private static readonly INTERCEPTED_KEYS = new Set(['w', 't', 'n', 'l', 'r']);

  private registerKeyInterceptor() {
    this.terminal.attachCustomKeyEventHandler((event) => {
      // Manual scrollbar recovery: Ctrl+Shift+Home
      if (event.type === 'keydown' && event.ctrlKey && event.shiftKey
          && !event.altKey && !event.metaKey && event.key === 'Home') {
        event.preventDefault();
        this.logger?.info('scrollbar-recovery-manual');
        this.attemptScrollbarRecovery();
        return false;
      }

      if (
        event.type !== 'keydown' ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return true;
      }
      if (!TerminalCore.INTERCEPTED_KEYS.has(event.key)) return true;

      event.preventDefault();

      if (!isStandaloneMode() && event.key !== 'w') {
        this.promptPwaInstall();
      }

      return true;
    });
  }

  private promptPwaInstall() {
    if (isStandaloneMode()) return;
    if (wasInstallHintShown()) return;
    markInstallHintShown();

    if (hasDeferredInstallPrompt()) {
      void triggerInstallPrompt();
      return;
    }
    this.showInstallHintOverlay();
  }

  private showInstallHintOverlay() {
    const overlay = document.createElement('div');
    overlay.textContent = 'Browser hotkey interferes? Install as app for better keyboard support';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      padding: '12px',
      background: 'var(--popover)',
      color: 'var(--popover-foreground)',
      textAlign: 'center',
      fontSize: '14px',
      zIndex: '10000',
      pointerEvents: 'none',
    });
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 4000);
  }

  private onSelectionChange() {
    if (this.modifierSource) return;

    const selection = this.terminal?.getSelection() ?? '';
    if (selection === '') return;
    let copied = false;
    try {
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } catch { /* ignore */ }
    if (copied) {
      this.overlayAddon?.showOverlay('\u2702', 300);
      return;
    }
    this.overlayAddon?.showOverlay('Copy failed', 700);
  }

  /** Capture-phase paste listener: intercepts images from native paste events. */
  private registerNativePasteImageHandler(): void {
    const el = this.terminal?.element;
    if (!el) return;
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items;
      const itemTypes = items ? Array.from(items).map(it => it?.type ?? '(null)') : null;
      this.logger?.debug('paste-event', { itemCount: items?.length ?? 0, itemTypes });
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob || blob.size === 0 || blob.size > 10 * 1024 * 1024) {
          this.logger?.warn('paste-image-skip', { type: item.type, blobNull: blob === null, blobSize: blob?.size ?? 0 });
          continue;
        }
        e.stopImmediatePropagation();
        e.preventDefault();
        this.logger?.debug('paste-image-intercepted', { type: item.type, size: blob.size });
        void this.handleNativePasteImage(blob, item.type);
        return;
      }
      // No image found — check if clipboard was completely empty (likely paste permission denied on iOS)
      const hasText = e.clipboardData?.getData('text/plain') !== '';
      this.logger?.debug('paste-no-image', { itemCount: items.length, itemTypes, hasText });
      if (items.length === 0 && !hasText) {
        this.overlayAddon?.showOverlay('Clipboard empty \u2014 allow access when prompted', 2000);
      }
    };
    el.addEventListener('paste', onPaste, { capture: true });
    this.register({ dispose: () => el.removeEventListener('paste', onPaste, { capture: true }) });
  }

  /** Handle an image blob from a native paste event. */
  private async handleNativePasteImage(blob: Blob, mimeType: string): Promise<void> {
    const arrayBuffer = await blob.arrayBuffer();
    const requestId = this.sendClipboardImage(arrayBuffer, mimeType);
    if (requestId <= 0) {
      this.logger?.warn('paste-image-send-failed', { mimeType, dataSize: arrayBuffer.byteLength });
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
      this.logger?.warn('paste-image-socket-not-open', { readyState: socket?.readyState ?? -1 });
      return 0;
    }

    this.clipboardImageRequestId++;
    const requestId = this.clipboardImageRequestId;

    const mimeBytes = textEncoder.encode(mimeType);
    if (mimeBytes.length > 255) {
      this.logger?.warn('paste-image-mime-too-long', { mimeType, mimeLen: mimeBytes.length });
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
        this.logger?.warn('paste-image-ack-timeout', { requestId: _requestId, timeoutMs });
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
    this.register(terminal.onTitleChange(data => {
      if (data && data !== '' && !this.titleFixed) {
        this.title = data;
        document.title = data;
        this.callbacks.onTitleChange?.(data);
      }
    }));
    this.register(terminal.onData(data => this.sendData(data)));
    this.register(terminal.onBinary(data => this.sendData(Uint8Array.from(data, v => v.charCodeAt(0)))));
    this.register(terminal.onSelectionChange(() => this.onSelectionChange()));
    this.register(terminal.onResize(({ cols, rows }) => {
      const msg = JSON.stringify({ columns: cols, rows });
      this.socket?.send(this.textEncoder.encode(Command.RESIZE_TERMINAL + msg));
      if (this.resizeOverlay) overlayAddon.showOverlay(`${cols}x${rows}`, 300);
    }));

    this.register(addEventListener(window, 'beforeunload', (e) => this.onWindowUnload(e as BeforeUnloadEvent)));
    this.registerGestureDetection();

    // Detect container size changes (keyboard open/close, panel open/close,
    // window resize) and refit the terminal.
    if (this.parent) {
      const resizeObserver = new ResizeObserver(() => this.fitAddon.fit());
      resizeObserver.observe(this.parent);
      this.register({ dispose: () => resizeObserver.disconnect() });
    }
  }

  private onWindowUnload(event: BeforeUnloadEvent) {
    event.preventDefault();
    if (this.socket?.readyState === WebSocket.OPEN) {
      event.returnValue = 'Close terminal?';
    }
  }

  private onSocketOpen() {
    this.logger = new ClientLogger({
      sendToServer: (payload) => { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(payload); },
    });
    this.logger.info('websocket opened');
    const { textEncoder, terminal, fitAddon, overlayAddon } = this;

    // Sync terminal dimensions with actual viewport before sending handshake —
    // the window may have been resized while disconnected (resize listener was disposed).
    fitAddon.fit();

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
    this.socket?.send(textEncoder.encode(JSON.stringify(handshake)));

    // Clear any lingering overlay (e.g. "Reconnecting..." from failed initial attempts)
    overlayAddon.hideOverlay();

    if (this.opened) {
      terminal.options.disableStdin = false;
      overlayAddon.showOverlay('Reconnected', 300);
    } else {
      this.opened = true;
    }

    this.doReconnect = this.reconnect;
    this.reconnectDelay = 0;
    this.reconnectKeyDisposable?.dispose();
    this.reconnectKeyDisposable = undefined;
    this.registerWakeDetection();
    this.initListeners();
    this.startScrollbarHealthCheck();
    terminal.focus();
  }

  private scheduleReconnect() {
    this.reconnectDelay = Math.min(Math.max(this.reconnectDelay, 500) * 2, 10000);
    this.logger?.info('reconnecting', { delay: this.reconnectDelay });
    setTimeout(() => this.refreshToken().then(() => this.connect()), this.reconnectDelay);
  }

  private registerWakeDetection() {
    const check = () => {
      if (this.socket?.readyState !== WebSocket.OPEN && this.doReconnect) {
        this.logger?.info('stale connection, reconnecting');
        this.socket?.close();
      }
    };
    this.register(addEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    }));
    this.register(addEventListener(window, 'online', check));
  }

  private onSocketClose(event: CloseEvent) {
    this.logger?.info('websocket closed', { code: event.code });
    const { overlayAddon } = this;
    this.reconnectKeyDisposable?.dispose();
    this.reconnectKeyDisposable = undefined;
    this.dispose();

    if (event.code === 4004) {
      // Requested session not found on server — delegate to UI for shell selection
      this.options.sessionId = undefined;
      this.callbacks.onSessionNotFound?.();
      return;
    }

    if (event.code === 4001) {
      // Replaced by another connection or switching sessions — auto-reconnect
      overlayAddon.showOverlay('Reconnecting...');
      this.refreshToken().then(() => this.connect());
      return;
    }

    if (event.code === 4003) {
      // Connection replaced by another client — do not reconnect
      overlayAddon.showOverlay('Connection Closed');
      return;
    }

    if (event.code === 4002) {
      // Process exited
      overlayAddon.showOverlay('Process exited');
      if (this.currentSessionId) {
        this.callbacks.onSessionDied?.(this.currentSessionId);
      }
      return;
    }

    if (this.closeOnDisconnect) {
      overlayAddon.showOverlay('Connection Closed');
      window.close();
      return;
    }

    if (this.doReconnect) {
      overlayAddon.showOverlay('Reconnecting...');
      this.scheduleReconnect();
    } else {
      overlayAddon.showOverlay('Connection Closed');
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
      } catch { /* ignore malformed */ }
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
        } catch { /* ignore parse errors */ }
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
            this.callbacks.onEditorOpen?.(r['filePath'], r['content']);
          }
        }
      } catch { /* ignore malformed */ }
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
          this.logger?.debug('state-full-applied', {
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
        this.callbacks.onSessionInfo?.(info);
        break;
      }
      default:
        this.logger?.warn('unknown command', { cmd: cmd.toString(16) });
        break;
    }
  }

  private applyPreferences(prefs: ClientOptions) {
    const { terminal, fitAddon } = this;
    let needsFit = false;

    for (const [key, value] of Object.entries(prefs)) {
      switch (key) {
        case 'rendererType': this.setRendererType(value as RendererType); break;
        case 'disableLeaveAlert':
          if (value) window.removeEventListener('beforeunload', (e) => this.onWindowUnload(e as BeforeUnloadEvent));
          break;
        case 'disableResizeOverlay':
          if (value) this.resizeOverlay = false;
          break;
        case 'disableReconnect':
          if (value) { this.reconnect = false; this.doReconnect = false; }
          break;
        case 'closeOnDisconnect':
          if (value) { this.closeOnDisconnect = true; this.reconnect = false; this.doReconnect = false; }
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
    const { terminal } = this;
    const disposeCanvas = () => { try { this.canvasAddon?.dispose(); } catch { /* */ } this.canvasAddon = undefined; };
    const disposeWebgl = () => { try { this.webglAddon?.dispose(); } catch { /* */ } this.webglAddon = undefined; };
    const enableCanvas = () => {
      if (this.canvasAddon) return;
      this.canvasAddon = new CanvasAddon();
      disposeWebgl();
      try { terminal.loadAddon(this.canvasAddon); } catch { disposeCanvas(); }
    };
    const enableWebgl = () => {
      if (this.webglAddon) return;
      this.webglAddon = new WebglAddon();
      disposeCanvas();
      try {
        this.webglAddon.onContextLoss(() => { this.webglAddon?.dispose(); });
        terminal.loadAddon(this.webglAddon);
      } catch { disposeWebgl(); enableCanvas(); }
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
