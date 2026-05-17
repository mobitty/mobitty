// Transparent DOM text mirror that lets WebKit own selection + handles on
// iOS native. Mounted as a sibling of `.xterm` so the
// `.xterm { -webkit-touch-callout: none; }` rule doesn't reach it — that's
// what lets the system's long-press recognizer fire here and produce the
// real iOS handles + action sheet (Copy / Paste / Look Up / Share / …).
//
// One <div> per visible row, content read from `terminal.buffer.active`.
// The font/metrics are mirrored to xterm so the highlight on the
// transparent text aligns with the canvas glyphs underneath. While the
// user has an active selection inside the layer we suspend row updates so
// the WebKit selection range doesn't get invalidated by streaming output.
//
// On Copy we hijack the clipboardData and reconstruct the text from xterm's
// buffer — that fixes the wrap-line round-trip (one div per visible row
// would otherwise insert `\n` at each wrap point).

import type { Terminal, IDisposable } from '@xterm/xterm';

export interface IosSelectionLayerOptions {
  terminal: Terminal;
  /** The element passed to `terminal.open()` — parent of `.xterm`. */
  container: HTMLElement;
}

export class IosSelectionLayer {
  private terminal: Terminal;
  private container: HTMLElement;
  private layer: HTMLDivElement;
  private rows: HTMLDivElement[] = [];
  private disposables: IDisposable[] = [];

  // Set whenever the active Selection is inside our layer and not collapsed.
  // While true we leave the DOM text alone so the Range doesn't go stale.
  private selectionActive = false;
  // RAF coalescer so a burst of onRender events only resyncs once per frame.
  private syncRaf = 0;

  private boundSelectionChange: () => void;
  private boundCopy: (e: ClipboardEvent) => void;

  constructor(opts: IosSelectionLayerOptions) {
    this.terminal = opts.terminal;
    this.container = opts.container;

    this.layer = document.createElement('div');
    this.layer.className = 'ios-selection-layer';
    this.container.appendChild(this.layer);

    this.disposables.push(this.terminal.onRender(() => this.scheduleSync()));
    this.disposables.push(this.terminal.onScroll(() => this.scheduleSync()));
    this.disposables.push(this.terminal.onResize(() => this.scheduleSync()));

    this.boundSelectionChange = () => this.onSelectionChange();
    document.addEventListener('selectionchange', this.boundSelectionChange);

    this.boundCopy = (e: ClipboardEvent) => this.onCopy(e);
    document.addEventListener('copy', this.boundCopy);

    this.syncNow();
  }

  dispose(): void {
    if (this.syncRaf !== 0) {
      cancelAnimationFrame(this.syncRaf);
      this.syncRaf = 0;
    }
    document.removeEventListener('selectionchange', this.boundSelectionChange);
    document.removeEventListener('copy', this.boundCopy);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.rows.length = 0;
    this.layer.remove();
  }

  /** Set the WebKit selection over the rectangle returned by xterm's
   *  `terminal.getSelectionPosition()`. Clamps to the visible viewport
   *  since the layer only mirrors visible rows. Returns false if there is
   *  no visible portion of the xterm selection to mirror. */
  showCurrentTerminalSelection(): boolean {
    const pos = this.terminal.getSelectionPosition();
    if (!pos) return false;
    return this.extendNativeSelection(pos.start.x, pos.start.y, pos.end.x, pos.end.y);
  }

  /** Set the WebKit selection over a buffer-coordinate range. Buffer Y
   *  coordinates outside the current viewport are clamped to the viewport
   *  edge. Returns false if the resulting range is empty. */
  extendNativeSelection(startX: number, startBufY: number, endX: number, endBufY: number): boolean {
    this.syncNow();

    const term = this.terminal;
    const viewportY = term.buffer.active.viewportY;
    const lastVisibleBufY = viewportY + term.rows - 1;

    let sBufY = startBufY;
    let sX = startX;
    let eBufY = endBufY;
    let eX = endX;
    if (sBufY < viewportY) { sBufY = viewportY; sX = 0; }
    if (eBufY > lastVisibleBufY) { eBufY = lastVisibleBufY; eX = term.cols; }
    if (eBufY < sBufY) return false;

    const startRow = this.rows[sBufY - viewportY];
    const endRow = this.rows[eBufY - viewportY];
    if (!startRow || !endRow) return false;
    const startNode = startRow.firstChild ?? startRow;
    const endNode = endRow.firstChild ?? endRow;
    const startLen = (startNode.textContent ?? '').length;
    const endLen = (endNode.textContent ?? '').length;

    const range = document.createRange();
    try {
      range.setStart(startNode, Math.min(sX, startLen));
      range.setEnd(endNode, Math.min(eX, endLen));
    } catch {
      return false;
    }
    if (range.collapsed) return false;

    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  /** Drop any current selection in our layer (no-op if the active selection
   *  is somewhere else on the page). */
  dismiss(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this.layer.contains(range.commonAncestorContainer)) return;
    sel.removeAllRanges();
  }

  // ── DOM sync ────────────────────────────────────────────────────────────

  private scheduleSync(): void {
    if (this.selectionActive) return;
    if (this.syncRaf !== 0) return;
    this.syncRaf = requestAnimationFrame(() => {
      this.syncRaf = 0;
      this.syncNow();
    });
  }

  private syncNow(): void {
    this.syncGeometry();
    this.syncRows();
  }

  /** Mirror xterm's font + cell-grid origin onto the layer so the
   *  transparent text lines up over the canvas glyphs. */
  private syncGeometry(): void {
    const termEl = this.terminal.element;
    if (!termEl) return;
    const screen = termEl.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen) return;

    const containerRect = this.container.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();

    const opts = this.terminal.options;
    const fontFamily = opts.fontFamily ?? 'monospace';
    const fontSize = opts.fontSize ?? 15;
    const lineHeight = opts.lineHeight ?? 1.0;
    const letterSpacing = opts.letterSpacing ?? 0;
    const cellHeight = screen.clientHeight / Math.max(1, this.terminal.rows);

    const style = this.layer.style;
    style.position = 'absolute';
    style.left = (screenRect.left - containerRect.left) + 'px';
    style.top = (screenRect.top - containerRect.top) + 'px';
    style.width = screen.clientWidth + 'px';
    style.height = screen.clientHeight + 'px';
    style.fontFamily = fontFamily;
    style.fontSize = fontSize + 'px';
    style.lineHeight = String(lineHeight);
    if (typeof letterSpacing === 'number') {
      style.letterSpacing = letterSpacing + 'px';
    }
    // Lock the row height so the divs land exactly over xterm cells
    // regardless of font-metric drift.
    style.setProperty('--mobitty-cell-height', cellHeight + 'px');
  }

  private syncRows(): void {
    const term = this.terminal;
    const rows = term.rows;
    const viewportY = term.buffer.active.viewportY;

    while (this.rows.length < rows) {
      const row = document.createElement('div');
      row.className = 'ios-selection-row';
      this.layer.appendChild(row);
      this.rows.push(row);
    }
    while (this.rows.length > rows) {
      const row = this.rows.pop();
      row?.remove();
    }

    const buf = term.buffer.active;
    for (let i = 0; i < rows; i++) {
      const line = buf.getLine(viewportY + i);
      // translateToString(false) — keep trailing whitespace so selection
      // offsets line up with on-screen cell columns. translateToString(true)
      // would trim spaces and shift offsets relative to the cells.
      const text = line ? line.translateToString(false) : '';
      const row = this.rows[i]!;
      if (row.textContent !== text) row.textContent = text;
    }
  }

  // ── Selection tracking ─────────────────────────────────────────────────

  private onSelectionChange(): void {
    const sel = window.getSelection();
    let active = false;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (this.layer.contains(range.commonAncestorContainer)) {
        active = true;
      }
    }
    if (active === this.selectionActive) return;
    this.selectionActive = active;
    if (!active) {
      // Selection went away — catch up any updates we skipped while it was held.
      this.scheduleSync();
    }
  }

  // ── Copy interception ──────────────────────────────────────────────────

  /** WebKit's default behavior for a selection across <div> rows is to
   *  insert `\n` between divs. That's wrong for xterm: wrapped rows are
   *  one logical line. We compute the correct text directly from
   *  `terminal.buffer.active`, using `line.isWrapped` to decide whether
   *  to join or break. */
  private onCopy(e: ClipboardEvent): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!this.layer.contains(range.commonAncestorContainer)) return;

    const startInfo = this.locateRow(range.startContainer);
    const endInfo = this.locateRow(range.endContainer);
    if (!startInfo || !endInfo) return;

    const text = this.buildSelectedText(
      startInfo.rowIndex, range.startOffset,
      endInfo.rowIndex, range.endOffset,
    );
    if (text === '') return;

    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
  }

  /** Find which mirror row a Selection endpoint sits in. The endpoint
   *  may be the row div itself (offset = childIndex) or its text node
   *  (offset = char index); we normalize to the row index either way. */
  private locateRow(node: Node): { rowIndex: number } | null {
    let n: Node | null = node;
    while (n && n !== this.layer) {
      if (n.nodeType === 1 && (n as Element).classList?.contains('ios-selection-row')) {
        const idx = this.rows.indexOf(n as HTMLDivElement);
        if (idx >= 0) return { rowIndex: idx };
      }
      n = n.parentNode;
    }
    return null;
  }

  private buildSelectedText(
    startRowIdx: number, startOffset: number,
    endRowIdx: number, endOffset: number,
  ): string {
    const term = this.terminal;
    const viewportY = term.buffer.active.viewportY;
    const buf = term.buffer.active;

    // Normalize ordering — Selection ranges are always start ≤ end in
    // document order, but Range offsets can sit at the boundary of a
    // sibling element when the selection covers a whole row.
    let sIdx = startRowIdx;
    let eIdx = endRowIdx;
    let sOff = startOffset;
    let eOff = endOffset;
    if (sIdx > eIdx || (sIdx === eIdx && sOff > eOff)) {
      [sIdx, eIdx] = [eIdx, sIdx];
      [sOff, eOff] = [eOff, sOff];
    }

    const pieces: string[] = [];
    for (let i = sIdx; i <= eIdx; i++) {
      const line = buf.getLine(viewportY + i);
      if (!line) continue;
      let rowText = line.translateToString(false);
      if (i === eIdx) rowText = rowText.slice(0, Math.min(eOff, rowText.length));
      if (i === sIdx) rowText = rowText.slice(Math.min(sOff, rowText.length));

      // Strip the trailing run of NBSP/space that xterm pads short rows
      // with — they're padding cells, not part of the visible content. Keep
      // them on wrap-continuation rows whose next row IS wrapped (those
      // spaces are real and roundtripped through the wrap), but for plain
      // text rows the user expects rstripped copy semantics.
      if (i < eIdx) {
        const nextLine = buf.getLine(viewportY + i + 1);
        const nextWrapped = !!nextLine && nextLine.isWrapped;
        if (!nextWrapped) {
          rowText = rowText.replace(/[  ]+$/, '');
        }
      } else {
        rowText = rowText.replace(/[  ]+$/, '');
      }

      pieces.push(rowText);

      if (i < eIdx) {
        const nextLine = buf.getLine(viewportY + i + 1);
        const nextWrapped = !!nextLine && nextLine.isWrapped;
        if (!nextWrapped) pieces.push('\n');
      }
    }
    return pieces.join('');
  }
}
