// iOS-style selection handles and edit menu for touch devices.
// Renders draggable handles at selection endpoints and a floating
// Copy / Select All menu.  Desktop is unaffected.

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
}

export class SelectionOverlayAddon implements ITerminalAddon {
  private terminal: Terminal | null = null;
  private disposables: IDisposable[] = [];
  private isTouchDevice: () => boolean;

  // DOM
  private container: HTMLDivElement | null = null;
  private startHandle: HTMLDivElement | null = null;
  private endHandle: HTMLDivElement | null = null;
  private editMenu: HTMLDivElement | null = null;

  // State
  private selection: SelectionRange | null = null;
  private dragTarget: DragTarget | null = null;
  private active = false;
  private cellWidth = 0;
  private cellHeight = 0;

  // Auto-scroll during drag
  private scrollInterval: ReturnType<typeof setInterval> | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Bound listeners for cleanup
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundOnPointerUp: ((e: PointerEvent) => void) | null = null;
  private boundOnTerminalPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundBlockTouch: ((e: TouchEvent) => void) | null = null;

  constructor(options: SelectionOverlayOptions) {
    this.isTouchDevice = options.isTouchDevice;
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

    // Dismiss on terminal output
    this.disposables.push(terminal.onWriteParsed(() => {
      if (this.active) this.dismiss();
    }));

    // Recalculate on resize
    this.disposables.push(terminal.onResize(() => {
      if (this.active) {
        this.measureCells();
        this.updatePositions();
      }
    }));
  }

  dispose(): void {
    this.stopAutoScroll();
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

    this.startHandle = this.createHandle('start');
    this.endHandle = this.createHandle('end');
    this.editMenu = this.createEditMenu();

    this.container.appendChild(this.startHandle);
    this.container.appendChild(this.endHandle);
    this.container.appendChild(this.editMenu);
  }

  private createHandle(target: DragTarget): HTMLDivElement {
    const handle = document.createElement('div');
    Object.assign(handle.style, {
      position: 'absolute',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      pointerEvents: 'auto',
      touchAction: 'none',
      cursor: 'grab',
    });

    // Stem
    const stem = document.createElement('div');
    Object.assign(stem.style, {
      width: '2px',
      height: '6px',
      background: '#007AFF',
    });

    // Circle (drag target)
    const circle = document.createElement('div');
    Object.assign(circle.style, {
      width: '20px',
      height: '20px',
      borderRadius: '50%',
      background: '#007AFF',
      boxSizing: 'content-box',
      padding: '10px',
      margin: '-10px',
    });

    // Start handle: circle above, stem below (points into selection)
    // End handle: stem above, circle below
    if (target === 'start') {
      handle.appendChild(circle);
      handle.appendChild(stem);
    } else {
      handle.appendChild(stem);
      handle.appendChild(circle);
    }

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      this.onHandlePointerDown(target, e);
    });

    return handle;
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
      userSelect: 'none',
      WebkitUserSelect: 'none',
      overflow: 'hidden',
    });

    const copyBtn = this.createMenuButton('Copy', () => void this.onCopy());
    menu.appendChild(copyBtn);

    return menu;
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

    // Use pointerup to avoid 300ms click delay
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
    const screen = this.terminal?.element?.querySelector('.xterm-screen');
    if (!screen || !this.terminal) return;
    this.cellWidth = screen.clientWidth / this.terminal.cols;
    this.cellHeight = screen.clientHeight / this.terminal.rows;
  }

  private updatePositions(): void {
    if (!this.terminal || !this.selection || !this.startHandle || !this.endHandle || !this.editMenu) return;

    const viewportY = this.terminal.buffer.active.viewportY;
    const rows = this.terminal.rows;

    // Start handle: positioned at top-left of selection start cell
    const startViewRow = this.selection.start.y - viewportY;
    const startX = this.selection.start.x * this.cellWidth;
    const startY = startViewRow * this.cellHeight;

    if (startViewRow >= 0 && startViewRow < rows) {
      this.startHandle.style.display = 'flex';
      this.startHandle.style.left = (startX - 10) + 'px'; // center the 20px circle
      this.startHandle.style.top = (startY - 26) + 'px';  // circle(20) + stem(6) above the line
    } else {
      this.startHandle.style.display = 'none';
    }

    // End handle: positioned at bottom-right of selection end cell
    const endViewRow = this.selection.end.y - viewportY;
    const endX = this.selection.end.x * this.cellWidth;
    const endY = (endViewRow + 1) * this.cellHeight;

    if (endViewRow >= 0 && endViewRow < rows) {
      this.endHandle.style.display = 'flex';
      this.endHandle.style.left = (endX - 10) + 'px';
      this.endHandle.style.top = (endY) + 'px'; // stem + circle below the line
    } else {
      this.endHandle.style.display = 'none';
    }

    // Edit menu: centered above the start handle, or below end if too high
    this.positionEditMenu(startX, startY, endX, endY);
  }

  private positionEditMenu(startX: number, startY: number, endX: number, endY: number): void {
    if (!this.editMenu || !this.terminal?.element) return;

    const termRect = this.terminal.element.getBoundingClientRect();
    const menuWidth = this.editMenu.offsetWidth || 150; // estimate before first render
    const menuHeight = this.editMenu.offsetHeight || 36;

    // Horizontal: center between start and end
    const midX = (startX + endX) / 2;
    let menuLeft = midX - menuWidth / 2;
    menuLeft = Math.max(0, Math.min(termRect.width - menuWidth, menuLeft));

    // Vertical: prefer above start handle
    const aboveY = startY - 26 - menuHeight - 4;
    if (aboveY >= 0) {
      this.editMenu.style.top = aboveY + 'px';
    } else {
      // Below end handle
      this.editMenu.style.top = (endY + 26 + 4) + 'px';
    }

    this.editMenu.style.left = menuLeft + 'px';
    this.editMenu.style.display = 'flex';
  }

  // ── Handle Dragging ───────────────────────────────────────────────────────

  private onHandlePointerDown(target: DragTarget, e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();

    this.dragTarget = target;

    const handleEl = target === 'start' ? this.startHandle : this.endHandle;
    if (handleEl) {
      handleEl.setPointerCapture(e.pointerId);
    }

    this.boundOnPointerMove = (ev: PointerEvent) => this.onHandlePointerMove(ev);
    this.boundOnPointerUp = (ev: PointerEvent) => this.onHandlePointerUp(ev);
    document.addEventListener('pointermove', this.boundOnPointerMove);
    document.addEventListener('pointerup', this.boundOnPointerUp);

    // Hide edit menu during drag
    if (this.editMenu) {
      this.editMenu.style.display = 'none';
    }
  }

  private onHandlePointerMove(e: PointerEvent): void {
    if (!this.terminal || !this.selection || !this.dragTarget) return;

    const termEl = this.terminal.element;
    if (!termEl) return;

    const rect = termEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    // Auto-scroll when pointer is beyond viewport edges
    this.updateAutoScroll(relY, rect.height);

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
  }

  private onHandlePointerUp(e: PointerEvent): void {
    this.stopAutoScroll();

    const handleEl = this.dragTarget === 'start' ? this.startHandle : this.endHandle;
    if (handleEl) {
      handleEl.releasePointerCapture(e.pointerId);
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
    const relX = this.lastPointerX - rect.left;
    const relY = this.lastPointerY - rect.top;

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

  // ── Event Handlers ────────────────────────────────────────────────────────

  private onTerminalPointerDown(e: PointerEvent): void {
    if (!this.active) return;
    // If the tap is inside the overlay container, let it through
    const target = e.target;
    if (target instanceof Node && this.container?.contains(target)) return;
    this.dismiss();
  }

  private onScroll(): void {
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
