import type { IBufferCell, IBufferLine, Terminal } from '@xterm/headless';

// xterm.js color mode constants from getFgColorMode()/getBgColorMode()
const CM_P16     = 0x1000000;  // 16-color palette
const CM_P256    = 0x2000000;  // 256-color palette
const CM_RGB     = 0x3000000;  // 24-bit RGB

interface CellSnapshot {
  char: string;
  width: number;
  fg: number;
  bg: number;
  fgMode: number;
  bgMode: number;
  attrs: number;
  // OSC 8 hyperlink id (0 = none). Resolved to URI via FrameSnapshot.urlIdToUri.
  // xterm.js doesn't expose this on IBufferCell, so we reach into the internal
  // `extended.urlId` slot.
  urlId: number;
}

// xterm.js internal cell shape that exposes the OSC 8 link id.
interface InternalBufferCell {
  extended?: { urlId?: number };
}

// xterm.js internal Terminal shape that exposes the OSC link service.
interface InternalTerminal {
  _core?: {
    _oscLinkService?: {
      getLinkData(id: number): { uri: string } | undefined;
    };
  };
}

function readCellUrlId(cell: unknown): number {
  return (cell as InternalBufferCell).extended?.urlId ?? 0;
}

function readUriForUrlId(terminal: Terminal, urlId: number): string | undefined {
  if (!urlId) return undefined;
  return (terminal as unknown as InternalTerminal)._core?._oscLinkService?.getLinkData(urlId)?.uri;
}

// Mouse report encoding (DEC private modes 1005/1006/1015/1016). xterm.js's
// public `terminal.modes` does NOT expose this, so it can't be read the way
// `mouseTrackingMode` is — it's tracked out-of-band by `mouse-encoding.ts` and
// threaded in. 'default' is the legacy X10 encoding. See
// docs/done-bug-copilot-mouse-sgr-encoding-not-serialized.md.
export type MouseEncoding = 'default' | 'utf8' | 'sgr' | 'urxvt' | 'sgr-pixels';

/** Modes xterm.js does not expose on `terminal.modes`, tracked out-of-band by
 *  the session (`mouse-encoding.ts`, `kitty-keyboard.ts`) and threaded into
 *  `captureSnapshot` / `serializeFullState`. */
export interface TrackedModes {
  mouseEncoding: MouseEncoding;
  /** Kitty keyboard protocol flags of the active screen. See
   *  docs/todo-bug-ctrl-enter-alt-buffer.md. */
  kittyKeyboardFlags: number;
}

export const DEFAULT_TRACKED_MODES: Readonly<TrackedModes> = Object.freeze({
  mouseEncoding: 'default',
  kittyKeyboardFlags: 0,
});

interface TerminalModes {
  applicationCursorKeysMode: boolean;
  applicationKeypadMode: boolean;
  bracketedPasteMode: boolean;
  insertMode: boolean;
  mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any';
  mouseEncoding: MouseEncoding;
  kittyKeyboardFlags: number;
  originMode: boolean;
  reverseWraparoundMode: boolean;
  sendFocusMode: boolean;
  wraparoundMode: boolean;
}

export interface FrameSnapshot {
  cells: CellSnapshot[][];
  cursorX: number;
  cursorY: number;
  cursorHidden: boolean;
  bufferType: 'normal' | 'alternate';
  cols: number;
  rows: number;
  baseY: number;
  scrollCount: number;
  title: string;
  modes: TerminalModes;
  urlIdToUri: Map<number, string>;
}

// Bitmask for attrs: bold=1, dim=2, italic=4, underline=8, blink=16, inverse=32, invisible=64, strikethrough=128, overline=256
interface CellAttrMethods {
  isBold(): number;
  isDim(): number;
  isItalic(): number;
  isUnderline(): number;
  isBlink(): number;
  isInverse(): number;
  isInvisible(): number;
  isStrikethrough(): number;
  isOverline(): number;
}

function packAttrs(cell: CellAttrMethods): number {
  return (cell.isBold() ? 1 : 0)
    | (cell.isDim() ? 2 : 0)
    | (cell.isItalic() ? 4 : 0)
    | (cell.isUnderline() ? 8 : 0)
    | (cell.isBlink() ? 16 : 0)
    | (cell.isInverse() ? 32 : 0)
    | (cell.isInvisible() ? 64 : 0)
    | (cell.isStrikethrough() ? 128 : 0)
    | (cell.isOverline() ? 256 : 0);
}

function defaultModes(): TerminalModes {
  return {
    applicationCursorKeysMode: false,
    applicationKeypadMode: false,
    bracketedPasteMode: false,
    insertMode: false,
    mouseTrackingMode: 'none',
    mouseEncoding: 'default',
    kittyKeyboardFlags: 0,
    originMode: false,
    reverseWraparoundMode: false,
    sendFocusMode: false,
    wraparoundMode: true,
  };
}

function readModes(terminal: Terminal, tracked: Readonly<TrackedModes> = DEFAULT_TRACKED_MODES): TerminalModes {
  const m = terminal.modes;
  const mouseMap: Record<string, TerminalModes['mouseTrackingMode']> = {
    none: 'none', x10: 'x10', vt200: 'vt200', drag: 'drag', any: 'any',
  };
  return {
    applicationCursorKeysMode: m.applicationCursorKeysMode,
    applicationKeypadMode: m.applicationKeypadMode,
    bracketedPasteMode: m.bracketedPasteMode,
    insertMode: m.insertMode,
    mouseTrackingMode: mouseMap[m.mouseTrackingMode] ?? 'none',
    mouseEncoding: tracked.mouseEncoding,
    kittyKeyboardFlags: tracked.kittyKeyboardFlags,
    originMode: m.originMode,
    reverseWraparoundMode: m.reverseWraparoundMode,
    sendFocusMode: m.sendFocusMode,
    wraparoundMode: m.wraparoundMode,
  };
}

// Captures `rows` lines of the active buffer starting at absolute line `top`.
// The default, `baseY`, is the live screen; a smaller `top` captures a
// viewport scrolled back into history. `cursorX`/`cursorY` and `baseY` in the
// result always describe the live screen, whatever `top` is.
export function captureSnapshot(terminal: Terminal, title: string, cursorHidden: boolean, scrollCount: number, tracked: Readonly<TrackedModes> = DEFAULT_TRACKED_MODES, top?: number): FrameSnapshot {
  const buf = terminal.buffer.active;
  const cols = terminal.cols;
  const rows = terminal.rows;
  const baseY = buf.baseY;
  const firstLine = top ?? baseY;
  const cells: CellSnapshot[][] = [];
  const urlIdToUri = new Map<number, string>();

  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(firstLine + y);
    const row: CellSnapshot[] = [];
    if (line) {
      for (let x = 0; x < cols; x++) {
        // Fresh cell per position — see comment in serializeBufferOf: the
        // dest-pointer overload of `getCell(x, cell)` leaves `extended.urlId`
        // stale from the previous cell, which would mark every blank
        // following a hyperlink as still inside the link.
        const cell = line.getCell(x);
        if (!cell) {
          row.push({ char: ' ', width: 1, fg: 0, bg: 0, fgMode: 0, bgMode: 0, attrs: 0, urlId: 0 });
          continue;
        }
        const urlId = readCellUrlId(cell);
        if (urlId !== 0 && !urlIdToUri.has(urlId)) {
          const uri = readUriForUrlId(terminal, urlId);
          if (uri !== undefined) urlIdToUri.set(urlId, uri);
        }
        row.push({
          char: cell.getChars() || ' ',
          width: cell.getWidth(),
          fg: cell.getFgColor(),
          bg: cell.getBgColor(),
          fgMode: cell.getFgColorMode(),
          bgMode: cell.getBgColorMode(),
          attrs: packAttrs(cell),
          urlId: urlId !== 0 && urlIdToUri.has(urlId) ? urlId : 0,
        });
      }
    } else {
      for (let x = 0; x < cols; x++) {
        row.push({ char: ' ', width: 1, fg: 0, bg: 0, fgMode: 0, bgMode: 0, attrs: 0, urlId: 0 });
      }
    }
    cells.push(row);
  }

  return {
    cells,
    cursorX: buf.cursorX,
    cursorY: buf.cursorY,
    cursorHidden,
    bufferType: buf.type === 'alternate' ? 'alternate' : 'normal',
    cols,
    rows,
    baseY,
    scrollCount,
    title,
    modes: readModes(terminal, tracked),
    urlIdToUri,
  };
}

export function blankSnapshot(cols: number, rows: number): FrameSnapshot {
  const cells: CellSnapshot[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: CellSnapshot[] = [];
    for (let x = 0; x < cols; x++) {
      row.push({ char: ' ', width: 1, fg: 0, bg: 0, fgMode: 0, bgMode: 0, attrs: 0, urlId: 0 });
    }
    cells.push(row);
  }
  return {
    cells,
    cursorX: 0,
    cursorY: 0,
    cursorHidden: false,
    bufferType: 'normal',
    cols,
    rows,
    baseY: 0,
    scrollCount: 0,
    title: '',
    modes: defaultModes(),
    urlIdToUri: new Map(),
  };
}

/** The SGR state of a cell (or of the writing pen). Colors are -1 in the
 *  default mode, as xterm.js reports them. */
interface SgrCell {
  fg: number;
  bg: number;
  fgMode: number;
  bgMode: number;
  attrs: number;
}

function sgrSequence(cell: SgrCell): string {
  const parts: string[] = ['0'];

  if (cell.attrs & 1) parts.push('1');
  if (cell.attrs & 2) parts.push('2');
  if (cell.attrs & 4) parts.push('3');
  if (cell.attrs & 8) parts.push('4');
  if (cell.attrs & 16) parts.push('5');
  if (cell.attrs & 32) parts.push('7');
  if (cell.attrs & 64) parts.push('8');
  if (cell.attrs & 128) parts.push('9');
  if (cell.attrs & 256) parts.push('53');

  // Foreground
  if (cell.fgMode === CM_P16) {
    parts.push(cell.fg < 8 ? `${30 + cell.fg}` : `${90 + cell.fg - 8}`);
  } else if (cell.fgMode === CM_P256) {
    parts.push(`38;5;${cell.fg}`);
  } else if (cell.fgMode === CM_RGB) {
    parts.push(`38;2;${(cell.fg >> 16) & 0xff};${(cell.fg >> 8) & 0xff};${cell.fg & 0xff}`);
  }

  // Background
  if (cell.bgMode === CM_P16) {
    parts.push(cell.bg < 8 ? `${40 + cell.bg}` : `${100 + cell.bg - 8}`);
  } else if (cell.bgMode === CM_P256) {
    parts.push(`48;5;${cell.bg}`);
  } else if (cell.bgMode === CM_RGB) {
    parts.push(`48;2;${(cell.bg >> 16) & 0xff};${(cell.bg >> 8) & 0xff};${cell.bg & 0xff}`);
  }

  return `\x1b[${parts.join(';')}m`;
}

function cellSgrEqual(a: CellSnapshot, b: CellSnapshot): boolean {
  return a.attrs === b.attrs && a.fg === b.fg && a.bg === b.bg && a.fgMode === b.fgMode && a.bgMode === b.bgMode;
}

function cellEqual(a: CellSnapshot, b: CellSnapshot): boolean {
  return a.char === b.char && a.width === b.width && a.urlId === b.urlId && cellSgrEqual(a, b);
}

/**
 * Whether a VT stream can put a cell of `width` where it is, given the widths
 * of its neighbours in the row (undefined past either end). A wide character
 * and its second half are written as a pair. xterm.js can hold half a pair: a
 * wide character in the last column whose second half lies past `cols` (a
 * line the alternate buffer kept wider on shrink, or a reflow), or a half left
 * by ICH, DCH or a reflow. A stream cannot reproduce it — a wide character in
 * the last column wraps onto the next row, scrolling at the bottom — so each
 * half is sent as a null cell with its attributes.
 */
function isWritableCell(width: number, prevWidth: number | undefined, nextWidth: number | undefined): boolean {
  if (width === 2) return nextWidth === 0;
  if (width === 0) return prevWidth === 2;
  return true;
}

function osc8Open(uri: string): string {
  return `\x1b]8;;${uri}\x07`;
}

const OSC8_CLOSE = '\x1b]8;;\x07';

function emitModeChanges(prev: TerminalModes, curr: TerminalModes): string {
  let out = '';

  // Boolean modes mapped to DEC private mode numbers
  const boolModes: Array<[keyof TerminalModes, number]> = [
    ['applicationCursorKeysMode', 1],
    ['applicationKeypadMode', 66],
    ['originMode', 6],
    ['wraparoundMode', 7],
    ['reverseWraparoundMode', 45],
    ['bracketedPasteMode', 2004],
    ['sendFocusMode', 1004],
    ['insertMode', 4],
  ];

  for (const [key, code] of boolModes) {
    const p = prev[key] as boolean;
    const c = curr[key] as boolean;
    if (p !== c) {
      if (key === 'insertMode') {
        out += c ? `\x1b[${code}h` : `\x1b[${code}l`;
      } else {
        out += c ? `\x1b[?${code}h` : `\x1b[?${code}l`;
      }
    }
  }

  // Mouse tracking mode
  if (prev.mouseTrackingMode !== curr.mouseTrackingMode) {
    // Reset old mode
    const mouseOff: Record<string, number> = { x10: 9, vt200: 1000, drag: 1002, any: 1003 };
    const oldCode = mouseOff[prev.mouseTrackingMode];
    if (oldCode) out += `\x1b[?${oldCode}l`;
    const newCode = mouseOff[curr.mouseTrackingMode];
    if (newCode) out += `\x1b[?${newCode}h`;
  }

  // Mouse report encoding (SGR/UTF-8/urxvt/SGR-pixels). Not exposed on
  // terminal.modes, so tracked out-of-band and diffed here — without this a
  // TUI's `\x1b[?1006h` (e.g. Copilot CLI) never reaches the client and its
  // mouse reports arrive as garbled X10 bytes. See
  // docs/done-bug-copilot-mouse-sgr-encoding-not-serialized.md.
  if (prev.mouseEncoding !== curr.mouseEncoding) {
    const encCode: Record<string, number> = { utf8: 1005, sgr: 1006, urxvt: 1015, 'sgr-pixels': 1016 };
    const oldCode = encCode[prev.mouseEncoding];
    if (oldCode) out += `\x1b[?${oldCode}l`;
    const newCode = encCode[curr.mouseEncoding];
    if (newCode) out += `\x1b[?${newCode}h`;
  }

  // Kitty keyboard flags. The client only ever receives an assignment
  // (`CSI = N ; 1 u`), never push/pop, so its flags mirror the server's
  // active screen exactly. See docs/todo-bug-ctrl-enter-alt-buffer.md.
  if (prev.kittyKeyboardFlags !== curr.kittyKeyboardFlags) {
    out += `\x1b[=${curr.kittyKeyboardFlags};1u`;
  }

  return out;
}

export function generateDiff(prev: FrameSnapshot, curr: FrameSnapshot): string | null {
  const { rows, cols } = curr;
  let out = '';

  // Mode changes
  out += emitModeChanges(prev.modes, curr.modes);

  // Title change
  if (prev.title !== curr.title) {
    out += `\x1b]2;${curr.title}\x07`;
  }

  // Scroll handling — use baseY delta for the STATE_FULL threshold (large
  // pre-capacity burst) and scrollCount delta for actual newline emission.
  // scrollCount is a monotonic counter that keeps incrementing even when
  // baseY plateaus at the scrollback limit, fixing stale client scrollback.
  const baseYDelta = curr.baseY - prev.baseY;
  if (baseYDelta > rows) {
    return null; // Signal caller to send STATE_FULL
  }
  const deltaScroll = Math.min(curr.scrollCount - prev.scrollCount, rows);
  if (deltaScroll > 0) {
    // Move cursor to bottom of screen and emit newlines to scroll
    out += `\x1b[${rows};1H`;
    for (let i = 0; i < deltaScroll; i++) {
      out += '\n';
    }
  }

  // Visible area diff
  let lastSgr: CellSnapshot | null = null;
  let lastUrlId = 0;

  for (let y = 0; y < rows; y++) {
    const prevRow = prev.cells[y];
    const currRow = curr.cells[y];
    if (!prevRow || !currRow) continue;

    // For scroll case: rows that scrolled in are new, compare against shifted prev rows
    let effectivePrevRow = prevRow;
    if (deltaScroll > 0) {
      const prevY = y + deltaScroll;
      effectivePrevRow = prevY < rows ? (prev.cells[prevY] ?? prevRow) : [];
    }

    let x = 0;
    while (x < cols) {
      const cc = currRow[x]!;
      const pc = effectivePrevRow[x];

      if (pc && cellEqual(pc, cc)) {
        x++;
        continue;
      }

      // Emit CUP to position
      out += `\x1b[${y + 1};${x + 1}H`;

      // Collect run of changed cells on this row
      while (x < cols) {
        const c = currRow[x]!;
        const p = effectivePrevRow[x];

        if (p && cellEqual(p, c)) break;

        const writable = isWritableCell(c.width, currRow[x - 1]?.width, currRow[x + 1]?.width);
        if (c.width === 0 && writable) {
          // Second half of a wide char, written with it — skip
          x++;
          continue;
        }

        if (!lastSgr || !cellSgrEqual(lastSgr, c)) {
          out += sgrSequence(c);
          lastSgr = c;
        }

        if (c.urlId !== lastUrlId) {
          if (lastUrlId !== 0) out += OSC8_CLOSE;
          if (c.urlId !== 0) {
            const uri = curr.urlIdToUri.get(c.urlId);
            if (uri !== undefined) out += osc8Open(uri);
          }
          lastUrlId = c.urlId;
        }

        out += writable ? c.char : ' ';
        x++;
      }
    }
  }

  // Close any open OSC 8 link, then reset SGR
  if (lastUrlId !== 0) {
    out += OSC8_CLOSE;
  }
  if (lastSgr) {
    out += '\x1b[0m';
  }

  // Only emit cursor position if it moved or we emitted CUP sequences that displaced it
  const hasContent = out !== '';
  const cursorMoved = prev.cursorX !== curr.cursorX || prev.cursorY !== curr.cursorY;
  if (hasContent || cursorMoved) {
    out += `\x1b[${curr.cursorY + 1};${curr.cursorX + 1}H`;
  }

  // Wrap content in cursor hide to prevent flicker from intermediate CUP positions.
  // Only re-show cursor if the application wants it visible.
  const visibilityChanged = prev.cursorHidden !== curr.cursorHidden;
  if (out !== '') {
    out = '\x1b[?25l' + out + (curr.cursorHidden ? '' : '\x1b[?25h');
  } else if (visibilityChanged) {
    out = curr.cursorHidden ? '\x1b[?25l' : '\x1b[?25h';
  }

  return out;
}

export interface BufferStats {
  cols: number;
  rows: number;
  bufferLen: number;
  baseY: number;
  cursorX: number;
  cursorY: number;
  wrappedLines: number;
  fullWidthNonWrappedLines: number;
  // Lines whose internal cell-array width exceeds `cols`. xterm.js's alternate
  // buffer doesn't reflow on shrink — those cells past `cols` hold stale
  // pre-resize content that's invisible at the new width. See
  // done-bug-reconnect-alt-buffer-misaligned.md.
  staleWidthLines: number;
  bufferType: 'normal' | 'alternate';
}

// Counts wrapped vs non-wrapped rows in the buffer. fullWidthNonWrappedLines is
// the diagnostic for the "TUI emitted CRLF after filling the line" pattern that
// foils grow-reflow — those rows look full but xterm.js can't merge them later.
// bufferType reports which buffer is active so consumers can tell normal-mode
// stats from alt-mode (TUI) stats — see
// done-bug-reconnect-alt-buffer-misaligned.md.
export function bufferStats(terminal: Terminal): BufferStats {
  const buf = terminal.buffer.active;
  const cols = terminal.cols;
  let wrapped = 0;
  let fullNonWrapped = 0;
  let staleWidth = 0;
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    if (line.length > cols) staleWidth++;
    if (line.isWrapped) {
      wrapped++;
    } else if (line.translateToString(true).length === cols) {
      fullNonWrapped++;
    }
  }
  return {
    cols,
    rows: terminal.rows,
    bufferLen: buf.length,
    baseY: buf.baseY,
    cursorX: buf.cursorX,
    cursorY: buf.cursorY,
    wrappedLines: wrapped,
    fullWidthNonWrappedLines: fullNonWrapped,
    staleWidthLines: staleWidth,
    bufferType: buf.type === 'alternate' ? 'alternate' : 'normal',
  };
}

export interface LineSample {
  first: string[];
  last: string[];
}

// Sample first and last `n` lines of the buffer. Each line is rstripped and
// truncated to `maxChars`. Use for compact log snapshots.
export function sampleBufferLines(terminal: Terminal, n: number, maxChars = 60): LineSample {
  const buf = terminal.buffer.active;
  const total = buf.length;
  const first: string[] = [];
  const last: string[] = [];
  const take = Math.min(n, total);
  for (let i = 0; i < take; i++) {
    const line = buf.getLine(i);
    first.push(line ? line.translateToString(true).slice(0, maxChars) : '');
  }
  const lastStart = Math.max(take, total - n);
  for (let i = lastStart; i < total; i++) {
    const line = buf.getLine(i);
    last.push(line ? line.translateToString(true).slice(0, maxChars) : '');
  }
  return { first, last };
}

// Like sampleBufferLines, but explicitly samples the alternate buffer even when
// the active buffer is normal. Use to compare alt-buffer contents across
// transitions while a TUI is in alt mode — see
// done-bug-reconnect-alt-buffer-misaligned.md.
export function sampleAltBuffer(terminal: Terminal, n: number, maxChars = 60): LineSample {
  const buf = terminal.buffer.alternate;
  const total = buf.length;
  const first: string[] = [];
  const last: string[] = [];
  const take = Math.min(n, total);
  for (let i = 0; i < take; i++) {
    const line = buf.getLine(i);
    first.push(line ? line.translateToString(true).slice(0, maxChars) : '');
  }
  const lastStart = Math.max(take, total - n);
  for (let i = lastStart; i < total; i++) {
    const line = buf.getLine(i);
    last.push(line ? line.translateToString(true).slice(0, maxChars) : '');
  }
  return { first, last };
}

export interface RepetitionStats {
  scannedRows: number;
  consideredRows: number;
  duplicateRows: number;
  topGroups: Array<{ sample: string; count: number }>;
}

// Scan the entire buffer for repeated, content-rich lines — the
// signal we expect when the headless buffer accumulates multiple
// copies of paragraph-sized content (todo-bug-resize-induced-
// terminal-corruption.md). Filters out blanks, borders, and other
// low-entropy lines (length < 10 or distinct-char count < 5) so
// the score doesn't fire on legitimate decoration.
//
// Only call from low-frequency events — the scan is O(rows × cols)
// and a long-lived session's buffer can be thousands of rows deep.
export function detectLineRepetition(terminal: Terminal): RepetitionStats {
  const buf = terminal.buffer.active;
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
  return {
    scannedRows: total,
    consideredRows: considered,
    duplicateRows,
    topGroups: groups.slice(0, 5),
  };
}

export interface BytesSummary {
  len: number;
  sample: string;
  crlfCount: number;
  bareLfCount: number;
  escCount: number;
}

// Summarize a chunk of VT bytes for safe logging. `sample` is the first
// `maxLen` chars with control bytes escaped so the JSONL stays single-line.
export function summarizeBytes(data: string | Uint8Array, maxLen = 120): BytesSummary {
  const str = typeof data === 'string' ? data : new TextDecoder('utf-8', { fatal: false }).decode(data);
  let crlf = 0;
  let bareLf = 0;
  let esc = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 0x1b) esc++;
    else if (c === 0x0a) {
      if (i > 0 && str.charCodeAt(i - 1) === 0x0d) crlf++;
      else bareLf++;
    }
  }
  const sample = str.slice(0, maxLen)
    .replace(/\x1b/g, '\\e')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/[\x00-\x1f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return { len: str.length, sample, crlfCount: crlf, bareLfCount: bareLf, escCount: esc };
}

function serializeModes(modes: TerminalModes): string {
  let out = '';
  if (modes.applicationCursorKeysMode) out += '\x1b[?1h';
  if (modes.applicationKeypadMode) out += '\x1b[?66h';
  if (modes.bracketedPasteMode) out += '\x1b[?2004h';
  if (modes.insertMode) out += '\x1b[4h';
  if (modes.originMode) out += '\x1b[?6h';
  if (modes.reverseWraparoundMode) out += '\x1b[?45h';
  if (modes.sendFocusMode) out += '\x1b[?1004h';
  if (!modes.wraparoundMode) out += '\x1b[?7l';
  switch (modes.mouseTrackingMode) {
    case 'x10': out += '\x1b[?9h'; break;
    case 'vt200': out += '\x1b[?1000h'; break;
    case 'drag': out += '\x1b[?1002h'; break;
    case 'any': out += '\x1b[?1003h'; break;
  }
  switch (modes.mouseEncoding) {
    case 'utf8': out += '\x1b[?1005h'; break;
    case 'sgr': out += '\x1b[?1006h'; break;
    case 'urxvt': out += '\x1b[?1015h'; break;
    case 'sgr-pixels': out += '\x1b[?1016h'; break;
  }
  // Kitty keyboard flags — always emitted, even 0. xterm.js swaps kitty flags
  // on every `?1049h/l`, so the client's STATE_FULL prefix (`?1049l`) plus this
  // payload's `?1049h` would bring back a previous session's alternate-screen
  // flags. Only an assignment after the buffer switch is correct; this runs
  // after the alternate-buffer content, so it lands on the right screen.
  out += `\x1b[=${modes.kittyKeyboardFlags};1u`;
  return out;
}

// Build a full-state byte stream that, written to a client xterm, reconstructs
// the headless terminal's buffer including OSC 8 hyperlinks. Replaces the
// previous `@xterm/addon-serialize`-based path (`addon-serialize` 0.14 has no
// OSC 8 support — markdown URLs from Claude Code lost their link attribute
// before reaching the client; only the underline + color survived).
export function serializeFullState(terminal: Terminal, title: string, cursorHidden: boolean, tracked: Readonly<TrackedModes> = DEFAULT_TRACKED_MODES): string {
  // Hide cursor for the duration of the client's write to prevent flicker.
  // Reset the pen (SGR and any open OSC 8 link) + clear screen + home cursor
  // before the buffer payload so the client starts from a known-clean slate.
  // SGR reset MUST precede `\x1b[2J`: xterm.js uses BCE (Background Color
  // Erase) and fills cleared cells with the current SGR background, not the
  // terminal default. serializeBufferOf relies on starting with that pen.
  let out = '\x1b[?25l\x1b[0m' + OSC8_CLOSE + '\x1b[2J\x1b[H';

  const isAlt = terminal.buffer.active.type === 'alternate';
  if (isAlt) {
    // Match @xterm/addon-serialize: when the source is in alternate-buffer
    // mode, serialize the normal buffer first, then enter alt and serialize
    // the alt buffer. The client's STATE_FULL prefix has already exited any
    // prior alt mode (see terminal-core.ts STATE_FULL handler), so a fresh
    // serializer starts from normal mode. serializeBufferOf ends with the pen
    // reset, so `?1049h` fills the alternate screen with the default
    // background.
    out += serializeBufferOf(terminal, terminal.buffer.normal, /* isAlt */ false);
    out += '\x1b[?1049h\x1b[H';
    out += serializeBufferOf(terminal, terminal.buffer.alternate, /* isAlt */ true);
  } else {
    out += serializeBufferOf(terminal, terminal.buffer.active, /* isAlt */ false);
  }

  out += serializeModes(readModes(terminal, tracked));

  const buf = terminal.buffer.active;
  const cursorRow = buf.cursorY + 1;
  const cursorCol = buf.cursorX + 1;
  out += `\x1b[${cursorRow};${cursorCol}H`;

  if (title) out += `\x1b]2;${title}\x07`;
  if (!cursorHidden) out += '\x1b[?25h';
  return out;
}

type HeadlessBuffer = Terminal['buffer']['active'];

/** One cell as serializeBufferOf reads it. */
interface LiveCell extends SgrCell {
  /** '' for a null cell: never written, or erased. */
  chars: string;
  /** 0 for the second half of a wide character. */
  width: number;
  /** OSC 8 link target, '' for none. */
  uri: string;
}

const DEFAULT_SGR: Readonly<SgrCell> = Object.freeze({ fg: -1, bg: -1, fgMode: 0, bgMode: 0, attrs: 0 });
const NULL_CELL: Readonly<LiveCell> = Object.freeze({ ...DEFAULT_SGR, chars: '', width: 1, uri: '' });

function bgEqual(a: SgrCell, b: SgrCell): boolean {
  return a.bgMode === b.bgMode && (a.bgMode === 0 || a.bg === b.bg);
}

function sgrEqual(a: SgrCell, b: SgrCell): boolean {
  return a.attrs === b.attrs && a.fgMode === b.fgMode && (a.fgMode === 0 || a.fg === b.fg) && bgEqual(a, b);
}

function isDefaultSgr(c: SgrCell): boolean {
  return c.attrs === 0 && c.fgMode === 0 && c.bgMode === 0;
}

/** The pen an erase (ECH, EL, ED, a scroll) fills cells with in xterm.js:
 *  the current background only. */
function eraseSgr(c: SgrCell): SgrCell {
  return { ...DEFAULT_SGR, bg: c.bg, bgMode: c.bgMode };
}

/** A null cell an erase can produce: no foreground, flags or link. Other null
 *  cells come from wide characters (the pad left when one wraps, the half left
 *  when one is overwritten), which take the full pen; those are written as a
 *  space with their attributes. */
function isErasedCell(c: LiveCell): boolean {
  return c.chars === '' && c.width === 1 && c.fgMode === 0 && c.attrs === 0 && c.uri === '';
}

/** Written as a character (a null cell that is not an erased cell as a space). */
function isPrintedCell(c: LiveCell): boolean {
  return c.width !== 0 && !isErasedCell(c);
}

function isBlankCell(c: LiveCell): boolean {
  return isErasedCell(c) && c.bgMode === 0;
}

// `cols` cells of `line`; cells past `line.length` read as null. Capped at
// `cols`, not `line.length`: xterm.js's alternate buffer does not reflow on
// shrink — line memory keeps the pre-shrink width, and the cells past `cols`
// hold stale pre-resize content. Emitting them produced text > cols per row,
// and the client's xterm.js autowrapped at `cols`, creating phantom wrap-pair
// continuations that pushed real alt-buffer content off the viewport. See
// done-bug-reconnect-alt-buffer-misaligned.md.
//
// Half a wide-character pair reads as a null cell with its attributes (see
// isWritableCell).
function readRow(terminal: Terminal, line: IBufferLine | undefined, cols: number): LiveCell[] {
  const cells: IBufferCell[] = [];
  const width = line ? Math.min(line.length, cols) : 0;
  for (let x = 0; x < width; x++) {
    // Allocate a fresh cell per position. The dest-pointer overload of
    // `getCell(x, cell)` updates the SGR fields but leaves `cell.extended`
    // (where `urlId` lives) stale from the previous cell, which collapses
    // OSC 8 spans into "single endless link" output and breaks the close
    // emission. Until xterm.js stops sharing `extended` across getCell
    // calls, the per-cell allocation is required for correctness.
    const cell = line?.getCell(x);
    if (!cell) break;
    cells.push(cell);
  }
  const row = cells.map((cell, x): LiveCell => {
    const writable = isWritableCell(cell.getWidth(), cells[x - 1]?.getWidth(), cells[x + 1]?.getWidth());
    return {
      chars: writable ? cell.getChars() : '',
      width: writable ? cell.getWidth() : 1,
      fg: cell.getFgColor(),
      bg: cell.getBgColor(),
      fgMode: cell.getFgColorMode(),
      bgMode: cell.getBgColorMode(),
      attrs: packAttrs(cell),
      uri: readUriForUrlId(terminal, readCellUrlId(cell)) ?? '',
    };
  });
  while (row.length < cols) row.push(NULL_CELL);
  return row;
}

// Internal helper: walks `buf` and emits a byte stream that reconstructs it,
// cell for cell, on a client xterm whose screen is clear, cursor home and pen
// reset (SGR default, no link). The terminal is still required for
// `_oscLinkService` lookups. Ported from `@xterm/addon-serialize` 0.15's
// string serializer, plus OSC 8 links and the `isAlt` rule below.
//
// Row-count rule (mirrors `@xterm/addon-serialize`): when the buffer fits in
// the viewport (`buf.length <= rows`), only emit rows up to the last row that
// is not blank — emitting trailing blank rows would write extra `\r\n`s that
// scroll real content off the top. When the buffer has spilled into
// scrollback (`buf.length > rows`), emit every row so the client ends up with
// the same `baseY`. The alternate buffer always sends its viewport only.
// Either way, separators go *between* rows, not after the last one — that
// final `\r\n` would also scroll. Pen changes are emitted only in rows that
// are emitted, so the stream ends with the pen it reports.
//
// Cells: characters are written with their SGR and link. Null cells that an
// erase can produce (background only) are not written: a run whose
// background differs from the row's is set with ECH (`CSI n X`, which does
// not move the cursor), the rest is skipped with CUF. ECH keeps them null,
// where spaces would make them content (copied text, reflow). Other null
// cells (a wide character's pad, or a half it left) carry a full pen, which
// no erase sets: they are written as a space with their attributes.
//
// Rows: the client's row starts blank with the default background, except a
// row that scrolls in (a row index >= `rows`): xterm.js fills it with the
// background of the pen that scrolled it (BCE). So the pen goes back to the
// default before a `\r\n` that scrolls, and a row entered by autowrap takes
// the background of its first cell.
//
// `isAlt` controls how `isWrapped` continuation rows are emitted. For the
// normal buffer (`isAlt=false`) a continuation row is entered by autowrap, so
// the client marks it wrapped and can reflow the pair at its own width. When
// the row before it does not end on its last column (erased or partly
// overwritten after it wrapped, or left short by a resize), the wrap is
// forced: print a placeholder in the last column, print one more character
// to wrap, erase it, and restore the last cell. For the alternate buffer (`isAlt=true`) every row gets a
// `\r\n` — alt-buffer `isWrapped` flags are not semantic (they come from
// xterm.js's asymmetric shrink path splitting full-width CRLF rows like
// Claude Code's separators) and joining them causes the client to autowrap
// differently from the server, producing the wrap-pair misalignment
// documented in done-bug-reconnect-alt-buffer-misaligned.md.
function serializeBufferOf(terminal: Terminal, buf: HeadlessBuffer, isAlt: boolean): string {
  const rows = terminal.rows;
  const cols = terminal.cols;
  // Lines [top, end) of `buf`; lines past its length read blank. The
  // alternate buffer has no scrollback on the client, so only its viewport is
  // sent: after a shrink xterm.js can keep lines above it (`baseY > 0`), and
  // after a later grow the viewport can even run past the last line.
  const top = isAlt ? buf.baseY : 0;
  const end = isAlt ? top + rows : buf.length;

  let emitEnd = end;
  if (end - top <= rows) {
    emitEnd = top;
    for (let y = top; y < end; y++) {
      if (!readRow(terminal, buf.getLine(y), cols).every(isBlankCell)) emitEnd = y + 1;
    }
  }

  let out = '';
  // The client's pen.
  let pen: SgrCell = DEFAULT_SGR;
  let penUri = '';
  const setSgr = (c: SgrCell): void => {
    if (!sgrEqual(pen, c)) { out += sgrSequence(c); pen = c; }
  };
  const setUri = (uri: string): void => {
    if (uri !== penUri) { out += uri ? osc8Open(uri) : OSC8_CLOSE; penUri = uri; }
  };

  // Writes `cells[0, end)` of a row whose blank cells have `rowBg`, starting
  // with the cursor at column 0 (or pending a wrap onto this row). Returns the
  // cursor column: `cols` when the row ends with a character in its last
  // column, so the next printed character wraps.
  const emitRow = (cells: LiveCell[], rowBg: SgrCell, end: number): number => {
    let col = 0;
    let runStart = 0;
    let runCount = 0;
    let runBg: SgrCell = DEFAULT_SGR;
    const moveTo = (x: number): void => {
      if (x > col) out += x - col === 1 ? '\x1b[C' : `\x1b[${x - col}C`;
      col = x;
    };
    const flushRun = (): void => {
      if (runCount === 0) return;
      moveTo(runStart);
      if (!bgEqual(pen, runBg)) setSgr(eraseSgr(runBg));
      out += runCount === 1 ? '\x1b[X' : `\x1b[${runCount}X`;
      runCount = 0;
    };
    for (let x = 0; x < end; x++) {
      const c = cells[x]!;
      if (c.width === 0) continue;
      if (isErasedCell(c)) {
        if (bgEqual(c, rowBg)) { flushRun(); continue; }
        if (runCount > 0 && bgEqual(runBg, c) && runStart + runCount === x) { runCount++; continue; }
        flushRun();
        runStart = x;
        runCount = 1;
        runBg = c;
        continue;
      }
      flushRun();
      moveTo(x);
      setSgr(c);
      setUri(c.uri);
      out += c.chars || ' ';
      col = x + c.width;
    }
    flushRun();
    return col;
  };

  let rowBg: SgrCell = DEFAULT_SGR;
  let cells = emitEnd > top ? readRow(terminal, buf.getLine(top), cols) : [];
  for (let y = top; y < emitEnd; y++) {
    const isLast = y + 1 >= emitEnd;
    const nextLine = isLast ? undefined : buf.getLine(y + 1);
    const nextCells = isLast ? [] : readRow(terminal, nextLine, cols);
    const wrapsNext = !isAlt && !isLast && nextLine?.isWrapped === true;
    const last = cells[cols - 1] ?? NULL_CELL;
    const first = nextCells[0] ?? NULL_CELL;

    // A wide character that did not fit in the last column wrapped and left a
    // null pad cell there with its pen: written the same way, the client
    // leaves the same pad.
    const padWraps = wrapsNext && cols >= 2 && last.chars === '' && last.width === 1
      && first.width === 2 && first.chars !== ''
      && sgrEqual(last, first) && last.uri === first.uri
      && !isErasedCell(cells[cols - 2]!);

    const col = emitRow(cells, rowBg, padWraps ? cols - 1 : cols);

    if (!isLast) {
      const scrolls = y + 1 - top >= rows;
      if (!wrapsNext) {
        if (scrolls && pen.bgMode !== 0) setSgr(DEFAULT_SGR);
        out += '\r\n';
        rowBg = DEFAULT_SGR;
      } else if (padWraps || (col === cols && isPrintedCell(first))) {
        // The next row's first character wraps onto it.
        rowBg = scrolls ? eraseSgr(first) : DEFAULT_SGR;
      } else {
        // Force the wrap. Not at the last column: print a placeholder there
        // (restored below) so the cursor is pending a wrap. Then wrap with a
        // default-pen space and erase it, so the new row is blank default.
        if (col !== cols) out += `\x1b[${cols}G `;
        setSgr(DEFAULT_SGR);
        out += ' \b\x1b[X';
        if (col !== cols) {
          out += `\x1b[A\x1b[${cols}G`;
          if (!bgEqual(pen, last)) setSgr(eraseSgr(last));
          out += '\x1b[X\x1b[B\r';
        }
        rowBg = DEFAULT_SGR;
      }
    }
    cells = nextCells;
  }

  setUri('');
  if (!isDefaultSgr(pen)) out += '\x1b[0m';
  return out;
}

export interface SnapshotMismatch {
  row: number;
  col: number;
  field: string;
  expected: string | number;
  actual: string | number;
}

export function compareSnapshots(
  expected: FrameSnapshot,
  actual: FrameSnapshot,
  maxMismatches: number,
): SnapshotMismatch[] {
  const mismatches: SnapshotMismatch[] = [];
  const rows = Math.min(expected.rows, actual.rows);
  const cols = Math.min(expected.cols, actual.cols);

  for (let y = 0; y < rows && mismatches.length < maxMismatches; y++) {
    const eRow = expected.cells[y];
    const aRow = actual.cells[y];
    if (!eRow || !aRow) continue;

    for (let x = 0; x < cols && mismatches.length < maxMismatches; x++) {
      const e = eRow[x];
      const a = aRow[x];
      if (!e || !a) continue;

      if (e.char !== a.char) mismatches.push({ row: y, col: x, field: 'char', expected: e.char, actual: a.char });
      if (e.fg !== a.fg) mismatches.push({ row: y, col: x, field: 'fg', expected: e.fg, actual: a.fg });
      if (e.bg !== a.bg) mismatches.push({ row: y, col: x, field: 'bg', expected: e.bg, actual: a.bg });
      if (e.fgMode !== a.fgMode) mismatches.push({ row: y, col: x, field: 'fgMode', expected: e.fgMode, actual: a.fgMode });
      if (e.bgMode !== a.bgMode) mismatches.push({ row: y, col: x, field: 'bgMode', expected: e.bgMode, actual: a.bgMode });
      if (e.attrs !== a.attrs) mismatches.push({ row: y, col: x, field: 'attrs', expected: e.attrs, actual: a.attrs });
    }
  }

  return mismatches;
}
