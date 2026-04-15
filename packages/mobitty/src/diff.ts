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

  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(baseY + y);
    const row: CellSnapshot[] = [];
    if (line) {
      const cell = line.getCell(0)!;
      for (let x = 0; x < cols; x++) {
        line.getCell(x, cell);
        row.push({
          char: cell.getChars() || ' ',
          width: cell.getWidth(),
          fg: cell.getFgColor(),
          bg: cell.getBgColor(),
          fgMode: cell.getFgColorMode(),
          bgMode: cell.getBgColorMode(),
          attrs: packAttrs(cell),
        });
      }
    } else {
      for (let x = 0; x < cols; x++) {
        row.push({ char: ' ', width: 1, fg: 0, bg: 0, fgMode: 0, bgMode: 0, attrs: 0 });
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
  };
}

export function blankSnapshot(cols: number, rows: number): FrameSnapshot {
  const cells: CellSnapshot[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: CellSnapshot[] = [];
    for (let x = 0; x < cols; x++) {
      row.push({ char: ' ', width: 1, fg: 0, bg: 0, fgMode: 0, bgMode: 0, attrs: 0 });
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
  return a.char === b.char && a.width === b.width && cellSgrEqual(a, b);
}

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

        out += c.char;
        x++;
      }
    }
  }

  // Reset SGR
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

export function serializeFullState(terminal: Terminal, title: string, cursorHidden: boolean): string {
  const buf = terminal.buffer.active;
  const cols = terminal.cols;
  const rows = terminal.rows;
  const baseY = buf.baseY;
  const totalLines = baseY + rows;

  // Hide cursor, set buffer mode, reset SGR, clear screen, home cursor.
  // Buffer switch MUST come before clear/home so they apply to the correct buffer.
  // SGR reset MUST come before 2J because xterm.js uses BCE (Background Color Erase):
  // \x1b[2J fills cells with the current SGR background, not default.
  let out = '\x1b[?25l';
  out += buf.type === 'alternate' ? '\x1b[?1049h' : '\x1b[?1049l';
  out += '\x1b[0m\x1b[2J\x1b[H';

  // Write all lines (scrollback + visible)
  const cell = buf.getLine(0)?.getCell(0);
  if (!cell) return out;

  for (let y = 0; y < totalLines; y++) {
    const line = buf.getLine(y);
    if (!line) {
      if (y < totalLines - 1) out += '\r\n';
      continue;
    }

    // Trim trailing empty cells to avoid unnecessary whitespace
    let lineEnd = cols;
    while (lineEnd > 0) {
      line.getCell(lineEnd - 1, cell);
      const ch = cell.getChars();
      if ((ch !== '' && ch !== ' ') || cell.getFgColorMode() !== 0 || cell.getBgColorMode() !== 0 || packAttrs(cell) !== 0) break;
      lineEnd--;
    }

    for (let x = 0; x < lineEnd; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue; // Skip continuation cells

      out += sgrSequence({
        char: '', width: 0,
        fg: cell.getFgColor(), bg: cell.getBgColor(),
        fgMode: cell.getFgColorMode(), bgMode: cell.getBgColorMode(),
        attrs: packAttrs(cell),
      });
      out += cell.getChars() || ' ';
    }

    // Reset SGR before line break to prevent BCE (Background Color Erase).
    // When \r\n causes scrolling, xterm.js fills the new blank row with
    // the current SGR background. Without this reset, empty lines following
    // colored content inherit the previous line's background color.
    if (lineEnd > 0) out += '\x1b[0m';

    if (y < totalLines - 1) out += '\r\n';
  }

  // Reset SGR before positioning cursor to avoid leaking color state to client
  out += '\x1b[0m';

  // Position cursor
  out += `\x1b[${buf.cursorY + 1};${buf.cursorX + 1}H`;

  // Mode-setting sequences
  const modes = readModes(terminal);
  const defaults = defaultModes();
  out += emitModeChanges(defaults, modes);

  // Title
  if (title) {
    out += `\x1b]2;${title}\x07`;
  }

  if (!cursorHidden) {
    out += '\x1b[?25h';
  }

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
