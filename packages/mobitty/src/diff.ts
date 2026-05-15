import type { Terminal } from '@xterm/headless';

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

interface TerminalModes {
  applicationCursorKeysMode: boolean;
  applicationKeypadMode: boolean;
  bracketedPasteMode: boolean;
  insertMode: boolean;
  mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any';
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
    originMode: false,
    reverseWraparoundMode: false,
    sendFocusMode: false,
    wraparoundMode: true,
  };
}

function readModes(terminal: Terminal): TerminalModes {
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
    originMode: m.originMode,
    reverseWraparoundMode: m.reverseWraparoundMode,
    sendFocusMode: m.sendFocusMode,
    wraparoundMode: m.wraparoundMode,
  };
}

export function captureSnapshot(terminal: Terminal, title: string, cursorHidden: boolean, scrollCount: number): FrameSnapshot {
  const buf = terminal.buffer.active;
  const cols = terminal.cols;
  const rows = terminal.rows;
  const baseY = buf.baseY;
  const cells: CellSnapshot[][] = [];
  const urlIdToUri = new Map<number, string>();

  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(baseY + y);
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
    modes: readModes(terminal),
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

function sgrSequence(cell: CellSnapshot): string {
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

        if (c.width === 0) {
          // Continuation cell for wide char — skip
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

        out += c.char;
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
}

// Counts wrapped vs non-wrapped rows in the buffer. fullWidthNonWrappedLines is
// the diagnostic for the "TUI emitted CRLF after filling the line" pattern that
// foils grow-reflow — those rows look full but xterm.js can't merge them later.
export function bufferStats(terminal: Terminal): BufferStats {
  const buf = terminal.buffer.active;
  let wrapped = 0;
  let fullNonWrapped = 0;
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    if (line.isWrapped) {
      wrapped++;
    } else if (line.translateToString(true).length === terminal.cols) {
      fullNonWrapped++;
    }
  }
  return {
    cols: terminal.cols,
    rows: terminal.rows,
    bufferLen: buf.length,
    baseY: buf.baseY,
    cursorX: buf.cursorX,
    cursorY: buf.cursorY,
    wrappedLines: wrapped,
    fullWidthNonWrappedLines: fullNonWrapped,
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

// Internal: SGR sequence for a live cell (during full-state serialization).
// Mirrors sgrSequence(CellSnapshot) but reads directly from a cell.
interface SgrCell {
  fg: number; bg: number; fgMode: number; bgMode: number; attrs: number;
}

function sgrSequenceLive(cell: SgrCell): string {
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
  if (cell.fgMode === CM_P16) parts.push(cell.fg < 8 ? `${30 + cell.fg}` : `${90 + cell.fg - 8}`);
  else if (cell.fgMode === CM_P256) parts.push(`38;5;${cell.fg}`);
  else if (cell.fgMode === CM_RGB) parts.push(`38;2;${(cell.fg >> 16) & 0xff};${(cell.fg >> 8) & 0xff};${cell.fg & 0xff}`);
  if (cell.bgMode === CM_P16) parts.push(cell.bg < 8 ? `${40 + cell.bg}` : `${100 + cell.bg - 8}`);
  else if (cell.bgMode === CM_P256) parts.push(`48;5;${cell.bg}`);
  else if (cell.bgMode === CM_RGB) parts.push(`48;2;${(cell.bg >> 16) & 0xff};${(cell.bg >> 8) & 0xff};${cell.bg & 0xff}`);
  return `\x1b[${parts.join(';')}m`;
}

function sgrLiveEqual(a: SgrCell, b: SgrCell): boolean {
  return a.attrs === b.attrs && a.fg === b.fg && a.bg === b.bg && a.fgMode === b.fgMode && a.bgMode === b.bgMode;
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
  return out;
}

// Build a full-state byte stream that, written to a client xterm, reconstructs
// the headless terminal's buffer including OSC 8 hyperlinks. Replaces the
// previous `@xterm/addon-serialize`-based path (`addon-serialize` 0.14 has no
// OSC 8 support — markdown URLs from Claude Code lost their link attribute
// before reaching the client; only the underline + color survived).
export function serializeFullState(terminal: Terminal, title: string, cursorHidden: boolean): string {
  // Hide cursor for the duration of the client's write to prevent flicker.
  // Reset SGR + clear screen + home cursor before the buffer payload so the
  // client starts from a known-clean slate. SGR reset MUST precede `\x1b[2J`:
  // xterm.js uses BCE (Background Color Erase) and fills cleared cells with
  // the current SGR background, not the terminal default.
  let out = '\x1b[?25l\x1b[0m\x1b[2J\x1b[H';

  const isAlt = terminal.buffer.active.type === 'alternate';
  if (isAlt) {
    // Match @xterm/addon-serialize: when the source is in alternate-buffer
    // mode, serialize the normal buffer first, then enter alt and serialize
    // the alt buffer. The client's STATE_FULL prefix has already exited any
    // prior alt mode (see terminal-core.ts STATE_FULL handler), so a fresh
    // serializer starts from normal mode.
    out += serializeBufferOf(terminal, terminal.buffer.normal);
    out += '\x1b[?1049h\x1b[H';
    out += serializeBufferOf(terminal, terminal.buffer.alternate);
  } else {
    out += serializeBufferOf(terminal, terminal.buffer.active);
  }

  out += serializeModes(readModes(terminal));

  const buf = terminal.buffer.active;
  const cursorRow = buf.cursorY + 1;
  const cursorCol = buf.cursorX + 1;
  out += `\x1b[${cursorRow};${cursorCol}H`;

  if (title) out += `\x1b]2;${title}\x07`;
  if (!cursorHidden) out += '\x1b[?25h';
  return out;
}

type HeadlessBuffer = Terminal['buffer']['active'];

// Internal helper: walks `buf` and emits a byte stream that reconstructs it on
// a client xterm. The terminal is still required for `_oscLinkService` lookups.
//
// Row-count rule (mirrors `@xterm/addon-serialize`): when the buffer fits in
// the viewport (`buf.length <= rows`), only emit rows up to the last row that
// contains a non-blank cell — emitting trailing blank rows would write extra
// `\r\n`s that scroll real content off the top. When the buffer has spilled
// into scrollback (`buf.length > rows`), emit every row so the client ends up
// with the same `baseY`. Either way, `\r\n` separators go *between* rows, not
// after the last one — that final `\r\n` would also scroll.
function serializeBufferOf(terminal: Terminal, buf: HeadlessBuffer): string {
  let lastSgr: SgrCell | null = null;
  let lastUrlId = 0;
  const total = buf.length;
  const rows = terminal.rows;
  let lastContentRow = -1;

  const rowOutputs: string[] = new Array(total);

  for (let y = 0; y < total; y++) {
    const line = buf.getLine(y);
    if (!line) { rowOutputs[y] = ''; continue; }
    let rowOut = '';
    const width = line.length;
    let trailing = 0;
    for (let x = 0; x < width; x++) {
      // Allocate a fresh cell per position. The dest-pointer overload of
      // `getCell(x, cell)` updates the SGR fields but leaves `cell.extended`
      // (where `urlId` lives) stale from the previous cell, which collapses
      // OSC 8 spans into "single endless link" output and breaks the close
      // emission. Until xterm.js stops sharing `extended` across getCell
      // calls, the per-cell allocation is required for correctness.
      const cellRef = line.getCell(x);
      if (!cellRef) continue;
      const w = cellRef.getWidth();
      if (w === 0) continue;
      const chars = cellRef.getChars();
      const sgr: SgrCell = {
        fg: cellRef.getFgColor(),
        bg: cellRef.getBgColor(),
        fgMode: cellRef.getFgColorMode(),
        bgMode: cellRef.getBgColorMode(),
        attrs: packAttrs(cellRef),
      };
      const urlId = readCellUrlId(cellRef);

      if (!lastSgr || !sgrLiveEqual(lastSgr, sgr)) {
        rowOut += sgrSequenceLive(sgr);
        lastSgr = sgr;
      }
      if (urlId !== lastUrlId) {
        if (lastUrlId !== 0) rowOut += OSC8_CLOSE;
        if (urlId !== 0) {
          const uri = readUriForUrlId(terminal, urlId);
          if (uri !== undefined) rowOut += osc8Open(uri);
        }
        lastUrlId = urlId;
      }
      if (chars === '') {
        trailing++;
      } else {
        if (trailing > 0) { rowOut += ' '.repeat(trailing); trailing = 0; }
        rowOut += chars;
        lastContentRow = y;
      }
    }
    rowOutputs[y] = rowOut;
  }

  const emitCount = total > rows ? total : Math.max(lastContentRow + 1, 0);

  let out = '';
  for (let i = 0; i < emitCount; i++) {
    out += rowOutputs[i];
    if (i + 1 < emitCount) {
      const nextLine = buf.getLine(i + 1);
      // Wrapped continuation lines must NOT get a row separator — let the
      // client's wrap detection rejoin them.
      if (!nextLine || !nextLine.isWrapped) out += '\r\n';
    }
  }

  if (lastUrlId !== 0) out += OSC8_CLOSE;
  if (lastSgr) out += '\x1b[0m';
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
