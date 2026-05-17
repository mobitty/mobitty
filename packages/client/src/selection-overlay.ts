// iOS-style selection handles and edit menu for touch devices.
// Renders draggable handles at selection endpoints and a floating
// Copy menu.  Desktop is unaffected.
//
// Each handle: a blue vertical bar (2px × cellHeight) on the boundary,
// with a small circle (10px) offset vertically.  The circle flips
// direction when near the viewport edge.  Touch target is 44px.

import type { ITerminalAddon, IDisposable, Terminal } from '@xterm/xterm';

/** 0-based buffer-absolute cell position (same space as getSelectionPosition). */
interface BufferCell {
  x: number;
  y: number;
}

interface SelectionRange {
  start: BufferCell;
  end: BufferCell;
}

type DragTarget = 'start' | 'end';

export interface SelectionOverlayOptions {
  isTouchDevice: () => boolean;
  onPaste?: () => void;
  /** Replay current selection to the TUI as a drag.  Only invoked when
   *  mouse mode is on; the host is responsible for dispatching the
   *  synthetic MouseEvents and clearing the xterm selection. */
  onSendToApp?: () => void;
  /** Active xterm renderer.  The loupe magnifies the WebGL canvas;
   *  it is suppressed when the DOM renderer is in effect. */
  getRenderer?: () => 'webgl' | 'dom';
}

export class SelectionOverlayAddon implements ITerminalAddon {
  private terminal: Terminal | null = null;
  private disposables: IDisposable[] = [];
  private isTouchDevice: () => boolean;

  // DOM — bars and circles are separate absolute elements, no flex nesting
  private container: HTMLDivElement | null = null;
  private startBar: HTMLDivElement | null = null;
  private startCircle: HTMLDivElement | null = null;
  private endBar: HTMLDivElement | null = null;
  private endCircle: HTMLDivElement | null = null;
  private editMenu: HTMLDivElement | null = null;
  // "Send to app" lives in the edit menu but only displays in mouse mode.
  private sendBtn: HTMLDivElement | null = null;
  private sendDivider: HTMLDivElement | null = null;
  // Standalone one-button menu shown by showPasteOnlyMenu — independent
  // of the selection lifecycle (no selection is active when it shows).
  private pasteMenu: HTMLDivElement | null = null;
  private pasteMenuActive = false;
  private mouseModeOn = false;

  // State
  private selection: SelectionRange | null = null;
  private dragTarget: DragTarget | null = null;
  private active = false;
  private cellWidth = 0;
  private cellHeight = 0;
  // Pixel offset of the .xterm-screen grid within terminal.element
  private gridOffsetX = 0;
  private gridOffsetY = 0;

  // Auto-scroll during drag
  private scrollInterval: ReturnType<typeof setInterval> | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  // Offset between pointer and the actual cell boundary, captured at drag start.
  // Applied during drag so the bar stays stable instead of jumping to finger pos.
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  // Bound listeners for cleanup
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundOnPointerUp: ((e: PointerEvent) => void) | null = null;
  private boundOnTerminalPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundBlockTouch: ((e: TouchEvent) => void) | null = null;

  private onPasteCallback?: () => void;
  private onSendToAppCallback?: () => void;
  private getRenderer?: () => 'webgl' | 'dom';

  // Loupe — circular magnifier shown while a handle is being dragged.
  private loupe: HTMLDivElement | null = null;
  private loupeCanvas: HTMLCanvasElement | null = null;
  private loupeCtx: CanvasRenderingContext2D | null = null;
  private loupeSourceCanvas: HTMLCanvasElement | null = null;
  private loupeRenderDisposable: IDisposable | null = null;

  constructor(options: SelectionOverlayOptions) {
    this.isTouchDevice = options.isTouchDevice;
    this.onPasteCallback = options.onPaste;
    this.onSendToAppCallback = options.onSendToApp;
    this.getRenderer = options.getRenderer;
  }

  activate(terminal: Terminal): void {
    this.terminal = terminal;
    if (!this.isTouchDevice()) return;

    this.createDOM();

    // Dismiss on tap outside
    this.boundOnTerminalPointerDown = (e: PointerEvent) => this.onTerminalPointerDown(e);
    terminal.element?.addEventListener('pointerdown', this.boundOnTerminalPointerDown, { capture: true });

    // Reposition on scroll
    this.disposables.push(terminal.onScroll(() => this.onScroll()));

    // Dismiss the selection overlay on terminal output (selection bounds
    // become stale).  The paste-only menu is just a popover at a fixed
    // viewport position with no selection bound — TUIs constantly
    // redraw, so we don't hide it on every write.
    this.disposables.push(terminal.onWriteParsed(() => {
      if (this.active) this.dismiss();
    }));

    // Recalculate on resize
    this.disposables.push(terminal.onResize(() => {
      if (this.active) {
        this.measureCells();
        this.updatePositions();
      }
      if (this.pasteMenuActive) this.hidePasteOnlyMenu();
    }));
  }

  dispose(): void {
    this.stopAutoScroll();
    this.stopLoupe();
    this.unblockTouchScroll();
    if (this.boundOnTerminalPointerDown && this.terminal?.element) {
      this.terminal.element.removeEventListener('pointerdown', this.boundOnTerminalPointerDown, { capture: true });
    }
    if (this.boundOnPointerMove) {
      document.removeEventListener('pointermove', this.boundOnPointerMove);
    }
    if (this.boundOnPointerUp) {
      document.removeEventListener('pointerup', this.boundOnPointerUp);
    }
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.container?.remove();
    this.container = null;
    this.pasteMenu?.remove();
    this.pasteMenu = null;
    this.pasteMenuActive = false;
    this.terminal = null;
  }

  /** Show handles + menu for the current terminal selection. */
  show(): void {
    const terminal = this.terminal;
    if (!terminal || !this.container) return;

    const pos = terminal.getSelectionPosition();
    if (!pos) return;

    this.selection = {
      start: { x: pos.start.x, y: pos.start.y },
      end: { x: pos.end.x, y: pos.end.y },
    };

    this.measureCells();

    if (!this.container.parentNode) {
      terminal.element?.appendChild(this.container);
    }

    this.active = true;
    this.container.style.display = '';
    this.blockTouchScroll();
    this.updatePositions();
  }

  /** Hide handles + menu and clear selection. */
  dismiss(): void {
    this.stopAutoScroll();
    this.stopLoupe();
    this.unblockTouchScroll();
    this.active = false;
    this.selection = null;
    this.dragTarget = null;
    if (this.container) {
      this.container.style.display = 'none';
    }
    this.terminal?.clearSelection();
  }

  // ── Touch Scroll Blocking ─────────────────────────────────────────────────

  /** Block xterm's touch-driven scroll while the overlay is active. */
  private blockTouchScroll(): void {
    if (this.boundBlockTouch) return;
    const el = this.terminal?.element;
    if (!el) return;
    this.boundBlockTouch = (e: TouchEvent) => {
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    el.addEventListener('touchmove', this.boundBlockTouch, { capture: true, passive: false });
  }

  private unblockTouchScroll(): void {
    if (!this.boundBlockTouch) return;
    const el = this.terminal?.element;
    if (el) {
      el.removeEventListener('touchmove', this.boundBlockTouch, { capture: true });
    }
    this.boundBlockTouch = null;
  }

  // ── DOM Construction ──────────────────────────────────────────────────────

  private createDOM(): void {
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '10',
      display: 'none',
    });

    this.startBar = this.createBar();
    this.startCircle = this.createCircle('start');
    this.endBar = this.createBar();
    this.endCircle = this.createCircle('end');
    this.editMenu = this.createEditMenu();
    this.loupe = this.createLoupe();

    this.container.appendChild(this.startBar);
    this.container.appendChild(this.startCircle);
    this.container.appendChild(this.endBar);
    this.container.appendChild(this.endCircle);
    this.container.appendChild(this.editMenu);
    this.container.appendChild(this.loupe);
  }

  /** Circular magnifier shown above the finger while a handle is dragged.
   *  Hosts an inner 2D <canvas> sized at devicePixelRatio. */
  private createLoupe(): HTMLDivElement {
    const size = SelectionOverlayAddon.LOUPE_SIZE;
    const loupe = document.createElement('div');
    Object.assign(loupe.style, {
      position: 'absolute',
      width: size + 'px',
      height: size + 'px',
      borderRadius: '50%',
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.4)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '12',
    });
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    Object.assign(canvas.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: size + 'px',
      height: size + 'px',
    });
    loupe.appendChild(canvas);
    this.loupeCanvas = canvas;
    this.loupeCtx = canvas.getContext('2d');
    return loupe;
  }

  /** Blue vertical bar marking the selection boundary. */
  private createBar(): HTMLDivElement {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'absolute',
      width: '2px',
      background: '#007AFF',
      pointerEvents: 'none',
    });
    return bar;
  }

  /** Draggable circle with 44px touch target (10px visible). */
  private createCircle(target: DragTarget): HTMLDivElement {
    const circle = document.createElement('div');
    Object.assign(circle.style, {
      position: 'absolute',
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      background: '#007AFF',
      backgroundClip: 'content-box',
      boxSizing: 'content-box',
      padding: '17px',
      margin: '-17px',
      pointerEvents: 'auto',
      touchAction: 'none',
      cursor: 'grab',
    });
    circle.addEventListener('pointerdown', (e: PointerEvent) => {
      this.onHandlePointerDown(target, e);
    });
    return circle;
  }

  private createEditMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    Object.assign(menu.style, {
      position: 'absolute',
      display: 'flex',
      gap: '0',
      background: '#2c2c2e',
      borderRadius: '8px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      overflow: 'hidden',
    });

    const copyBtn = this.createMenuButton('Copy', () => void this.onCopy());
    menu.appendChild(copyBtn);

    const divider = document.createElement('div');
    Object.assign(divider.style, { width: '1px', background: '#545458' });
    menu.appendChild(divider);

    const pasteBtn = this.createMenuButton('Paste', () => this.onPaste());
    menu.appendChild(pasteBtn);

    const sendDivider = document.createElement('div');
    Object.assign(sendDivider.style, { width: '1px', background: '#545458', display: 'none' });
    menu.appendChild(sendDivider);
    const sendBtn = this.createMenuButton('Send to app', () => this.onSendToApp());
    sendBtn.style.display = 'none';
    menu.appendChild(sendBtn);
    this.sendDivider = sendDivider;
    this.sendBtn = sendBtn;
    this.applySendToAppVisibility();

    return menu;
  }

  private applySendToAppVisibility(): void {
    if (!this.sendBtn || !this.sendDivider) return;
    const disp = this.mouseModeOn ? '' : 'none';
    this.sendBtn.style.display = disp;
    this.sendDivider.style.display = disp;
  }

  /** Called by the host whenever the TUI's mouse-tracking mode changes.
   *  Drives visibility of the "Send to app" button. */
  setMouseMode(mode: string): void {
    const on = mode !== 'none';
    if (on === this.mouseModeOn) return;
    this.mouseModeOn = on;
    this.applySendToAppVisibility();
    if (this.active) this.updatePositions();
  }

  private createMenuButton(label: string, action: () => void): HTMLDivElement {
    const btn = document.createElement('div');
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: '8px 16px',
      color: '#fff',
      fontSize: '14px',
      fontFamily: '-apple-system, system-ui, sans-serif',
      cursor: 'pointer',
    });

    // Use pointerup so the action fires before synthetic mousedown/mouseup/click.
    // touch-action:manipulation on the menu avoids the 300ms pointerup delay.
    btn.addEventListener('pointerup', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      action();
    });
    // Prevent pointerdown from dismissing via the terminal listener
    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      e.stopPropagation();
    });

    return btn;
  }

  // ── Positioning ───────────────────────────────────────────────────────────

  private measureCells(): void {
    const termEl = this.terminal?.element;
    const screen = termEl?.querySelector('.xterm-screen');
    if (!screen || !termEl || !this.terminal) return;
    this.cellWidth = screen.clientWidth / this.terminal.cols;
    this.cellHeight = screen.clientHeight / this.terminal.rows;
    // The cell grid may be offset within terminal.element (padding, viewport)
    const termRect = termEl.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    this.gridOffsetX = screenRect.left - termRect.left;
    this.gridOffsetY = screenRect.top - termRect.top;
  }

  // Gap between the cell edge and the circle center.
  private static readonly HANDLE_GAP = 20;
  // Circle visible radius (half of 10px).
  private static readonly CIRCLE_R = 5;
  // Loupe diameter in CSS pixels.
  private static readonly LOUPE_SIZE = 120;
  // Magnification factor.  iOS uses roughly 1.5-2x.
  private static readonly LOUPE_ZOOM = 1.6;
  // Vertical gap between the loupe bottom and the finger position.
  private static readonly LOUPE_LIFT = 24;

  private updatePositions(): void {
    if (!this.terminal || !this.selection) return;
    if (!this.startBar || !this.startCircle || !this.endBar || !this.endCircle || !this.editMenu) return;

    const viewportY = this.terminal.buffer.active.viewportY;
    const rows = this.terminal.rows;
    const termHeight = this.gridOffsetY + rows * this.cellHeight;
    const gap = SelectionOverlayAddon.HANDLE_GAP;
    const cr = SelectionOverlayAddon.CIRCLE_R;

    // ── Start handle ────────────────────────────────────────────────────
    const startViewRow = this.selection.start.y - viewportY;
    const startX = this.gridOffsetX + this.selection.start.x * this.cellWidth;
    const startCellTop = this.gridOffsetY + startViewRow * this.cellHeight;
    const startCellBot = startCellTop + this.cellHeight;

    if (startViewRow >= 0 && startViewRow < rows) {
      // Default: circle above cell.  Flip when near top edge.
      const startFlipped = startCellTop < (gap + cr);

      if (startFlipped) {
        // Circle below cell, bar extends from cell top down through gap
        this.positionBar(this.startBar, startX, startCellTop, this.cellHeight + gap);
        this.positionCircle(this.startCircle, startX, startCellBot + gap);
      } else {
        // Circle above cell, bar extends from gap up through cell
        this.positionBar(this.startBar, startX, startCellTop - gap, this.cellHeight + gap);
        this.positionCircle(this.startCircle, startX, startCellTop - gap);
      }
    } else {
      this.hideElement(this.startBar);
      this.hideElement(this.startCircle);
    }

    // ── End handle ──────────────────────────────────────────────────────
    const endViewRow = this.selection.end.y - viewportY;
    const endX = this.gridOffsetX + this.selection.end.x * this.cellWidth;
    const endCellTop = this.gridOffsetY + endViewRow * this.cellHeight;
    const endCellBot = endCellTop + this.cellHeight;

    if (endViewRow >= 0 && endViewRow < rows) {
      // Default: circle below cell.  Flip when near bottom edge.
      const endFlipped = (termHeight - endCellBot) < (gap + cr);

      if (endFlipped) {
        // Circle above cell, bar extends from gap up through cell
        this.positionBar(this.endBar, endX, endCellTop - gap, this.cellHeight + gap);
        this.positionCircle(this.endCircle, endX, endCellTop - gap);
      } else {
        // Circle below cell, bar extends from cell top down through gap
        this.positionBar(this.endBar, endX, endCellTop, this.cellHeight + gap);
        this.positionCircle(this.endCircle, endX, endCellBot + gap);
      }
    } else {
      this.hideElement(this.endBar);
      this.hideElement(this.endCircle);
    }

    // ── Edit menu ───────────────────────────────────────────────────────
    this.positionEditMenu(startX, startCellTop, endX, endCellBot);
  }

  /** Position a 2px bar centered on x, starting at top with given height. */
  private positionBar(bar: HTMLDivElement, x: number, top: number, height: number): void {
    bar.style.display = '';
    bar.style.left = (x - 1) + 'px';
    bar.style.top = top + 'px';
    bar.style.height = height + 'px';
  }

  /** Position a circle centered on (x, y). */
  private positionCircle(circle: HTMLDivElement, x: number, y: number): void {
    const cr = SelectionOverlayAddon.CIRCLE_R;
    circle.style.display = '';
    circle.style.left = (x - cr) + 'px';
    circle.style.top = (y - cr) + 'px';
  }

  private hideElement(el: HTMLDivElement): void {
    el.style.display = 'none';
  }

  private positionEditMenu(startX: number, startCellTop: number, endX: number, endCellBot: number): void {
    if (!this.editMenu || !this.terminal?.element) return;

    const termRect = this.terminal.element.getBoundingClientRect();
    const menuWidth = this.editMenu.offsetWidth || 150;
    const menuHeight = this.editMenu.offsetHeight || 36;
    const gap = SelectionOverlayAddon.HANDLE_GAP;
    const cr = SelectionOverlayAddon.CIRCLE_R;

    // Horizontal: center between start and end
    const midX = (startX + endX) / 2;
    let menuLeft = midX - menuWidth / 2;
    menuLeft = Math.max(0, Math.min(termRect.width - menuWidth, menuLeft));

    // Vertical: prefer above start handle
    const aboveY = startCellTop - gap - cr * 2 - menuHeight - 4;
    if (aboveY >= 0) {
      this.editMenu.style.top = aboveY + 'px';
    } else {
      // Below end handle
      this.editMenu.style.top = (endCellBot + gap + cr * 2 + 4) + 'px';
    }

    this.editMenu.style.left = menuLeft + 'px';
    this.editMenu.style.display = 'flex';
  }

  // ── Loupe ─────────────────────────────────────────────────────────────────

  /** Locate the main WebGL canvas under .xterm-screen.  The WebGL addon
   *  appends a LinkRenderLayer 2D canvas first and the main WebGL canvas
   *  after, so the last <canvas> child is the one with the rendered
   *  glyphs.  Probing getContext('webgl2') is safe because the link layer
   *  already owns a 2D context and the call returns null without
   *  attaching anything. */
  private resolveWebglCanvas(): HTMLCanvasElement | null {
    const screen = this.terminal?.element?.querySelector('.xterm-screen');
    if (!screen) return null;
    const canvases = Array.from(screen.querySelectorAll('canvas'));
    let last: HTMLCanvasElement | null = null;
    for (const c of canvases) {
      last = c;
      if (c.getContext('webgl2') || c.getContext('webgl')) return c;
    }
    return last;
  }

  /** Start the loupe for a fresh handle drag.  No-op when the active
   *  xterm renderer is the DOM fallback — drawImage of a span tree
   *  isn't meaningful and the perf upside is small. */
  private startLoupe(clientX: number, clientY: number): void {
    if (!this.loupe || !this.terminal) return;
    if (this.getRenderer && this.getRenderer() !== 'webgl') return;

    const canvas = this.resolveWebglCanvas();
    if (!canvas) return;
    this.loupeSourceCanvas = canvas;

    this.loupe.style.display = 'block';
    this.loupeRenderDisposable = this.terminal.onRender(() => this.drawLoupe());
    this.positionLoupe(clientX, clientY);
    this.drawLoupe();
  }

  private stopLoupe(): void {
    if (this.loupeRenderDisposable) {
      this.loupeRenderDisposable.dispose();
      this.loupeRenderDisposable = null;
    }
    this.loupeSourceCanvas = null;
    if (this.loupe) this.loupe.style.display = 'none';
  }

  private positionLoupe(clientX: number, clientY: number): void {
    if (!this.loupe || !this.terminal?.element) return;
    const termRect = this.terminal.element.getBoundingClientRect();
    const size = SelectionOverlayAddon.LOUPE_SIZE;
    const lift = SelectionOverlayAddon.LOUPE_LIFT;

    // Horizontal: center on finger, clamp within terminal element.
    let left = clientX - termRect.left - size / 2;
    left = Math.max(0, Math.min(termRect.width - size, left));

    // Vertical: prefer above the finger; flip below near the top edge.
    const aboveTop = clientY - termRect.top - size - lift;
    const top = aboveTop >= 0 ? aboveTop : clientY - termRect.top + lift;

    this.loupe.style.left = left + 'px';
    this.loupe.style.top = top + 'px';
  }

  private drawLoupe(): void {
    if (!this.loupeCtx || !this.loupeCanvas || !this.loupeSourceCanvas) return;
    if (!this.terminal || !this.selection || !this.dragTarget) return;

    const cell = this.dragTarget === 'start' ? this.selection.start : this.selection.end;
    const viewportY = this.terminal.buffer.active.viewportY;
    const viewRow = cell.y - viewportY;

    // Source coords are in the xterm canvas's own CSS-pixel space.
    // The canvas is a child of .xterm-screen with origin (0,0) at the
    // screen's top-left, so gridOffsetX/Y (which is termEl→screen) does
    // not apply here.
    const src = this.loupeSourceCanvas;
    const cssW = src.clientWidth || src.width;
    const cssH = src.clientHeight || src.height;
    const ratioX = cssW > 0 ? src.width / cssW : 1;
    const ratioY = cssH > 0 ? src.height / cssH : 1;

    const cx = cell.x * this.cellWidth;
    const cy = (viewRow + 0.5) * this.cellHeight;

    const size = SelectionOverlayAddon.LOUPE_SIZE;
    const zoom = SelectionOverlayAddon.LOUPE_ZOOM;
    const sourceCss = size / zoom;
    const sx = (cx - sourceCss / 2) * ratioX;
    const sy = (cy - sourceCss / 2) * ratioY;
    const sw = sourceCss * ratioX;
    const sh = sourceCss * ratioY;

    const ctx = this.loupeCtx;
    const dw = this.loupeCanvas.width;
    const dh = this.loupeCanvas.height;
    const bg = (this.terminal.options.theme?.background as string | undefined) ?? '#000';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  }

  // ── Handle Dragging ───────────────────────────────────────────────────────

  private onHandlePointerDown(target: DragTarget, e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();

    this.dragTarget = target;

    // Capture offset between pointer and the actual cell boundary pixel.
    // This keeps the bar stable under the finger instead of jumping.
    const termEl = this.terminal?.element;
    if (termEl && this.selection) {
      const rect = termEl.getBoundingClientRect();
      const cell = target === 'start' ? this.selection.start : this.selection.end;
      const viewportY = this.terminal?.buffer.active.viewportY ?? 0;
      const cellPixelX = rect.left + this.gridOffsetX + cell.x * this.cellWidth;
      const cellPixelY = rect.top + this.gridOffsetY + (cell.y - viewportY) * this.cellHeight;
      this.dragOffsetX = e.clientX - cellPixelX;
      this.dragOffsetY = e.clientY - cellPixelY;
    }

    const circleEl = target === 'start' ? this.startCircle : this.endCircle;
    if (circleEl) {
      circleEl.setPointerCapture(e.pointerId);
    }

    this.boundOnPointerMove = (ev: PointerEvent) => this.onHandlePointerMove(ev);
    this.boundOnPointerUp = (ev: PointerEvent) => this.onHandlePointerUp(ev);
    document.addEventListener('pointermove', this.boundOnPointerMove);
    document.addEventListener('pointerup', this.boundOnPointerUp);

    // Hide edit menu during drag
    if (this.editMenu) {
      this.editMenu.style.display = 'none';
    }

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.startLoupe(e.clientX, e.clientY);
  }

  private onHandlePointerMove(e: PointerEvent): void {
    if (!this.terminal || !this.selection || !this.dragTarget) return;

    const termEl = this.terminal.element;
    if (!termEl) return;

    const rect = termEl.getBoundingClientRect();
    // Subtract the drag offset so the bar tracks the boundary, not the finger
    const relX = e.clientX - this.dragOffsetX - rect.left - this.gridOffsetX;
    const relY = e.clientY - this.dragOffsetY - rect.top - this.gridOffsetY;

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    // Auto-scroll when pointer is beyond viewport edges
    const gridHeight = this.terminal.rows * this.cellHeight;
    this.updateAutoScroll(relY, gridHeight);

    // Convert pixel to cell
    const col = Math.max(0, Math.min(this.terminal.cols, Math.round(relX / this.cellWidth)));
    const viewportRow = Math.max(0, Math.min(this.terminal.rows - 1, Math.floor(relY / this.cellHeight)));
    const bufferY = viewportRow + this.terminal.buffer.active.viewportY;

    // Update the dragged endpoint
    if (this.dragTarget === 'start') {
      this.selection.start = { x: col, y: bufferY };
    } else {
      this.selection.end = { x: col, y: bufferY };
    }

    this.normalizeSelection();
    this.applySelection();
    this.updatePositions();
    this.positionLoupe(e.clientX, e.clientY);
    this.drawLoupe();
  }

  private onHandlePointerUp(e: PointerEvent): void {
    this.stopAutoScroll();

    const circleEl = this.dragTarget === 'start' ? this.startCircle : this.endCircle;
    if (circleEl) {
      circleEl.releasePointerCapture(e.pointerId);
    }

    if (this.boundOnPointerMove) {
      document.removeEventListener('pointermove', this.boundOnPointerMove);
      this.boundOnPointerMove = null;
    }
    if (this.boundOnPointerUp) {
      document.removeEventListener('pointerup', this.boundOnPointerUp);
      this.boundOnPointerUp = null;
    }

    this.dragTarget = null;
    this.stopLoupe();
    this.updatePositions();
  }

  // ── Auto-scroll ───────────────────────────────────────────────────────────

  private scrollDirection = 0;

  private updateAutoScroll(relY: number, termHeight: number): void {
    const newDir = relY < 0 ? -1 : relY > termHeight ? 1 : 0;
    if (newDir === this.scrollDirection) return;

    this.stopAutoScroll();
    this.scrollDirection = newDir;

    if (newDir !== 0) {
      this.scrollInterval = setInterval(() => this.autoScrollTick(newDir), 60);
    }
  }

  private autoScrollTick(direction: number): void {
    if (!this.terminal || !this.selection || !this.dragTarget) return;
    this.terminal.scrollLines(direction);

    // Recalculate the dragged endpoint based on current pointer position
    const termEl = this.terminal.element;
    if (!termEl) return;
    const rect = termEl.getBoundingClientRect();
    const relX = this.lastPointerX - this.dragOffsetX - rect.left - this.gridOffsetX;
    const relY = this.lastPointerY - this.dragOffsetY - rect.top - this.gridOffsetY;

    const col = Math.max(0, Math.min(this.terminal.cols, Math.round(relX / this.cellWidth)));
    const viewportRow = Math.max(0, Math.min(this.terminal.rows - 1, Math.floor(relY / this.cellHeight)));
    const bufferY = viewportRow + this.terminal.buffer.active.viewportY;

    if (this.dragTarget === 'start') {
      this.selection.start = { x: col, y: bufferY };
    } else {
      this.selection.end = { x: col, y: bufferY };
    }

    this.normalizeSelection();
    this.applySelection();
    this.updatePositions();
    this.positionLoupe(this.lastPointerX, this.lastPointerY);
    this.drawLoupe();
  }

  private stopAutoScroll(): void {
    if (this.scrollInterval) {
      clearInterval(this.scrollInterval);
      this.scrollInterval = null;
    }
    this.scrollDirection = 0;
  }

  // ── Selection Logic ───────────────────────────────────────────────────────

  private normalizeSelection(): void {
    if (!this.selection || !this.terminal) return;
    const cols = this.terminal.cols;
    const startLinear = this.selection.start.y * cols + this.selection.start.x;
    const endLinear = this.selection.end.y * cols + this.selection.end.x;
    if (startLinear > endLinear) {
      const tmp = this.selection.start;
      this.selection.start = this.selection.end;
      this.selection.end = tmp;
      // Swap drag target so the user keeps dragging the same handle
      if (this.dragTarget === 'start') {
        this.dragTarget = 'end';
      } else if (this.dragTarget === 'end') {
        this.dragTarget = 'start';
      }
    }
  }

  private applySelection(): void {
    if (!this.terminal || !this.selection) return;
    const cols = this.terminal.cols;
    const length = Math.max(1,
      (this.selection.end.y - this.selection.start.y) * cols +
      (this.selection.end.x - this.selection.start.x));
    this.terminal.select(this.selection.start.x, this.selection.start.y, length);
  }

  // ── Menu Actions ──────────────────────────────────────────────────────────

  private async onCopy(): Promise<void> {
    const text = this.terminal?.getSelection() ?? '';
    if (text === '') return;

    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch { /* fall through to execCommand */ }
    }

    if (!copied) {
      // Fallback: populate the hidden textarea so execCommand picks it up
      const textarea = this.terminal?.textarea;
      if (textarea) {
        textarea.value = text;
        textarea.select();
      }
      try {
        copied = typeof document.execCommand === 'function' && document.execCommand('copy');
      } catch { /* ignore */ }
    }

    this.dismiss();
  }

  private onPaste(): void {
    this.dismiss();
    this.onPasteCallback?.();
  }

  private onSendToApp(): void {
    // Caller reads selection and dispatches MouseEvents before we
    // clear the selection in dismiss().
    this.onSendToAppCallback?.();
    this.dismiss();
  }

  // ── Paste-only menu (no selection active) ────────────────────────────────

  private createPasteMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    Object.assign(menu.style, {
      position: 'absolute',
      display: 'none',
      background: '#2c2c2e',
      borderRadius: '8px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      overflow: 'hidden',
      zIndex: '11',
    });
    const btn = this.createMenuButton('Paste', () => this.onPasteFromPasteMenu());
    menu.appendChild(btn);
    return menu;
  }

  /** Show a one-button "Paste" popover near the given viewport coords.
   *  Independent of selection state — used for tap-near-cursor. */
  showPasteOnlyMenu(clientX: number, clientY: number): void {
    const termEl = this.terminal?.element;
    if (!termEl) return;
    if (!this.pasteMenu) {
      this.pasteMenu = this.createPasteMenu();
      termEl.appendChild(this.pasteMenu);
    }
    this.pasteMenu.style.display = 'block';
    this.pasteMenuActive = true;
    const termRect = termEl.getBoundingClientRect();
    const menuWidth = this.pasteMenu.offsetWidth || 80;
    const menuHeight = this.pasteMenu.offsetHeight || 36;
    let left = clientX - termRect.left - menuWidth / 2;
    left = Math.max(0, Math.min(termRect.width - menuWidth, left));
    const aboveTop = clientY - termRect.top - menuHeight - 12;
    const top = aboveTop >= 0 ? aboveTop : clientY - termRect.top + 24;
    this.pasteMenu.style.left = left + 'px';
    this.pasteMenu.style.top = top + 'px';
  }

  private hidePasteOnlyMenu(): void {
    if (this.pasteMenu) this.pasteMenu.style.display = 'none';
    this.pasteMenuActive = false;
  }

  private onPasteFromPasteMenu(): void {
    this.hidePasteOnlyMenu();
    this.onPasteCallback?.();
  }

  // ── Event Handlers ────────────────────────────────────────────────────────

  private onTerminalPointerDown(e: PointerEvent): void {
    const target = e.target;
    if (this.pasteMenuActive) {
      if (target instanceof Node && this.pasteMenu?.contains(target)) return;
      this.hidePasteOnlyMenu();
      return;
    }
    if (!this.active) return;
    // If the tap is inside the overlay container, let it through
    if (target instanceof Node && this.container?.contains(target)) return;
    this.dismiss();
  }

  private onScroll(): void {
    if (this.pasteMenuActive) this.hidePasteOnlyMenu();
    if (!this.active || !this.terminal || !this.selection) return;
    // During a handle drag, auto-scroll manages positioning directly
    if (this.dragTarget) return;

    const viewportY = this.terminal.buffer.active.viewportY;
    const rows = this.terminal.rows;
    const startVisible = this.selection.start.y >= viewportY && this.selection.start.y < viewportY + rows;
    const endVisible = this.selection.end.y >= viewportY && this.selection.end.y < viewportY + rows;

    if (!startVisible && !endVisible) {
      // Both endpoints off-viewport — hide but keep state
      if (this.container) this.container.style.display = 'none';
    } else {
      if (this.container) this.container.style.display = '';
      this.updatePositions();
    }
  }
}
