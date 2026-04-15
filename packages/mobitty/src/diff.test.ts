import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import headlessPkg from '@xterm/headless';
const { Terminal } = headlessPkg;
import { blankSnapshot, captureSnapshot, generateDiff, serializeFullState, compareSnapshots } from './diff.ts';

describe('blankSnapshot', () => {
  it('creates correct dimensions and defaults', () => {
    const snap = blankSnapshot(80, 24);
    assert.equal(snap.cols, 80);
    assert.equal(snap.rows, 24);
    assert.equal(snap.cells.length, 24);
    assert.equal(snap.cells[0]!.length, 80);
    assert.equal(snap.cursorX, 0);
    assert.equal(snap.cursorY, 0);
    assert.equal(snap.bufferType, 'normal');
    assert.equal(snap.baseY, 0);
    assert.equal(snap.title, '');
    assert.equal(snap.cursorHidden, false);
    assert.equal(snap.modes.wraparoundMode, true);
    assert.equal(snap.modes.applicationCursorKeysMode, false);
  });

  it('all cells are blank spaces', () => {
    const snap = blankSnapshot(10, 5);
    for (const row of snap.cells) {
      for (const cell of row) {
        assert.equal(cell.char, ' ');
        assert.equal(cell.width, 1);
        assert.equal(cell.fg, 0);
        assert.equal(cell.bg, 0);
        assert.equal(cell.attrs, 0);
      }
    }
  });
});

function writeAndWait(terminal: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise(resolve => terminal.write(data, resolve));
}

/** Capture snapshot using baseY as scrollCount (equivalent to pre-capacity behavior). */
function takeSnapshot(terminal: InstanceType<typeof Terminal>, title = '', cursorHidden = false, scrollCount?: number) {
  return captureSnapshot(terminal, title, cursorHidden, scrollCount ?? terminal.buffer.active.baseY);
}

describe('captureSnapshot', () => {
  it('captures characters and cursor position', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    await writeAndWait(term, 'Hello');
    const snap = takeSnapshot(term);
    assert.equal(snap.cells[0]![0]!.char, 'H');
    assert.equal(snap.cells[0]![1]!.char, 'e');
    assert.equal(snap.cells[0]![2]!.char, 'l');
    assert.equal(snap.cells[0]![3]!.char, 'l');
    assert.equal(snap.cells[0]![4]!.char, 'o');
    assert.equal(snap.cursorX, 5);
    assert.equal(snap.cursorY, 0);
    term.dispose();
  });

  it('captures SGR attributes', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    await writeAndWait(term, '\x1b[1mBold\x1b[0m');
    const snap = takeSnapshot(term);
    // Bold bit (1) should be set
    assert.ok(snap.cells[0]![0]!.attrs & 1, 'bold bit should be set');
    term.dispose();
  });

  it('captures palette and RGB colors', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    await writeAndWait(term, '\x1b[32mGreen\x1b[38;5;196mRed\x1b[0m');
    const snap = takeSnapshot(term);
    // P16 green: fgMode should be 0x1000000
    assert.equal(snap.cells[0]![0]!.fgMode, 0x1000000, 'P16 color mode');
    assert.equal(snap.cells[0]![0]!.fg, 2, 'green = palette 2');
    // P256 red: fgMode should be 0x2000000
    assert.equal(snap.cells[0]![5]!.fgMode, 0x2000000, 'P256 color mode');
    assert.equal(snap.cells[0]![5]!.fg, 196, 'red = palette 196');
    term.dispose();
  });

  it('captures title passed in', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const snap = takeSnapshot(term, 'MyTitle');
    assert.equal(snap.title, 'MyTitle');
    term.dispose();
  });
});

describe('generateDiff', () => {
  it('returns empty string for identical snapshots', () => {
    const snap = blankSnapshot(80, 24);
    const diff = generateDiff(snap, snap);
    assert.equal(diff, '');
  });

  it('detects character changes and emits CUP + content', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const prev = takeSnapshot(term);
    await writeAndWait(term, 'X');
    const curr = takeSnapshot(term);
    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null);
    assert.ok(diff.includes('\x1b[1;1H')); // CUP for char at (0,0)
    assert.ok(diff.includes('X'));
    term.dispose();
  });

  it('handles SGR attribute changes', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const prev = takeSnapshot(term);
    await writeAndWait(term, '\x1b[1mB\x1b[0m');
    const curr = takeSnapshot(term);
    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null);
    // Should contain SGR for bold
    assert.ok(diff.includes('\x1b['), 'should contain SGR sequence');
    assert.ok(diff.includes('B'));
    term.dispose();
  });

  it('handles scroll (baseY increase <= rows)', async () => {
    const term = new Terminal({ cols: 80, rows: 5, scrollback: 100, allowProposedApi: true });
    const prev = takeSnapshot(term);
    // Write enough lines to cause scroll
    await writeAndWait(term, 'line1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\n');
    const curr = takeSnapshot(term);
    assert.ok(curr.baseY > 0, 'should have scrolled');
    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null, 'should not need STATE_FULL for small scroll');
    term.dispose();
  });

  it('returns null for deltaScroll > rows', async () => {
    const term = new Terminal({ cols: 80, rows: 3, scrollback: 100, allowProposedApi: true });
    const prev = takeSnapshot(term);
    // Write many lines to cause large scroll
    let data = '';
    for (let i = 0; i < 20; i++) data += `line${i}\r\n`;
    await writeAndWait(term, data);
    const curr = takeSnapshot(term);
    assert.ok(curr.baseY > 3, 'should have scrolled past rows');
    const diff = generateDiff(prev, curr);
    assert.equal(diff, null, 'should signal STATE_FULL needed');
    term.dispose();
  });

  it('emits correct SGR for palette colors', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const prev = takeSnapshot(term);
    await writeAndWait(term, '\x1b[32mG\x1b[0m');
    const curr = takeSnapshot(term);
    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null);
    // Should contain standard SGR 32 for green (P16), not 38;5;2
    assert.ok(diff.includes(';32m') || diff.includes('\x1b[0;32m'), 'should emit P16 color as standard SGR');
    assert.ok(diff.includes('G'));
    term.dispose();
  });

  it('handles mode changes (emits DECSET/DECRST)', () => {
    const prev = blankSnapshot(80, 24);
    const curr = blankSnapshot(80, 24);
    curr.modes.applicationCursorKeysMode = true;
    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null);
    assert.ok(diff.includes('\x1b[?1h'), 'should set DECCKM');
  });

  it('handles title change (emits OSC 2)', () => {
    const prev = blankSnapshot(80, 24);
    const curr = blankSnapshot(80, 24);
    curr.title = 'NewTitle';
    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null);
    assert.ok(diff.includes('\x1b]2;NewTitle\x07'));
  });
});

describe('scrollback at capacity', () => {
  it('emits newlines when scrollCount increases but baseY stays the same', async () => {
    const scrollback = 10;
    const rows = 5;
    const term = new Terminal({ cols: 40, rows, scrollback, allowProposedApi: true });

    // Fill the buffer to capacity: scrollback + rows lines
    let data = '';
    for (let i = 1; i <= scrollback + rows; i++) data += `line${i}\r\n`;
    await writeAndWait(term, data);

    const baseYAtCapacity = term.buffer.active.baseY;
    assert.equal(baseYAtCapacity, scrollback, 'baseY should equal scrollback at capacity');

    // Capture the "previous" snapshot, using baseY as scrollCount (simulating tracked value)
    let scrollCount = baseYAtCapacity;
    const prev = takeSnapshot(term, '', false, scrollCount);

    // Write more lines — baseY stays at scrollback (circular buffer wraps)
    await writeAndWait(term, 'newline1\r\nnewline2\r\nnewline3\r\n');
    scrollCount += 3; // 3 more scroll events happened

    assert.equal(term.buffer.active.baseY, baseYAtCapacity, 'baseY should NOT have changed');

    const curr = takeSnapshot(term, '', false, scrollCount);
    assert.equal(curr.baseY, prev.baseY, 'baseY should be identical');
    assert.equal(curr.scrollCount - prev.scrollCount, 3, 'scrollCount delta should be 3');

    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null, 'should not trigger STATE_FULL');
    assert.ok(diff !== '', 'should produce a diff');

    // The diff should contain 3 newlines at the bottom (scroll handling)
    const newlineSequence = `\x1b[${rows};1H\n\n\n`;
    assert.ok(diff.includes(newlineSequence), 'diff should emit 3 newlines for scroll at capacity');

    term.dispose();
  });

  it('caps deltaScroll at rows when scrollCount delta exceeds rows', async () => {
    const scrollback = 10;
    const rows = 5;
    const term = new Terminal({ cols: 40, rows, scrollback, allowProposedApi: true });

    // Fill to capacity
    let data = '';
    for (let i = 1; i <= scrollback + rows; i++) data += `line${i}\r\n`;
    await writeAndWait(term, data);

    let scrollCount = term.buffer.active.baseY;
    const prev = takeSnapshot(term, '', false, scrollCount);

    // Write many more lines (scrollCount delta >> rows)
    for (let i = 0; i < 20; i++) data += `extra${i}\r\n`;
    await writeAndWait(term, data);
    scrollCount += 20;

    const curr = takeSnapshot(term, '', false, scrollCount);
    const diff = generateDiff(prev, curr);

    // Should NOT return null (STATE_FULL) since baseYDelta = 0
    assert.ok(diff !== null, 'should not trigger STATE_FULL when baseY unchanged');
    assert.ok(diff !== '', 'should produce a diff');

    // Should contain exactly `rows` newlines (capped)
    const cappedNewlines = `\x1b[${rows};1H` + '\n'.repeat(rows);
    assert.ok(diff.includes(cappedNewlines), 'should cap newlines at rows');

    term.dispose();
  });
});

describe('serializeFullState', () => {
  it('reproduces visible area on a fresh terminal', async () => {
    const src = new Terminal({ cols: 40, rows: 10, scrollback: 100, allowProposedApi: true });
    await writeAndWait(src, 'Hello World');
    const vt = serializeFullState(src, '', false);

    const dst = new Terminal({ cols: 40, rows: 10, scrollback: 100, allowProposedApi: true });
    await writeAndWait(dst, vt);

    // Check that "Hello World" appears in the destination
    const srcSnap = takeSnapshot(src);
    const dstSnap = takeSnapshot(dst);
    for (let x = 0; x < 11; x++) {
      assert.equal(dstSnap.cells[0]![x]!.char, srcSnap.cells[0]![x]!.char, `char at col ${x} should match`);
    }

    src.dispose();
    dst.dispose();
  });

  it('reproduces scrollback on a fresh terminal', async () => {
    const src = new Terminal({ cols: 40, rows: 5, scrollback: 100, allowProposedApi: true });
    let data = '';
    for (let i = 1; i <= 10; i++) data += `line${i}\r\n`;
    await writeAndWait(src, data);

    const vt = serializeFullState(src, '', false);
    const dst = new Terminal({ cols: 40, rows: 5, scrollback: 100, allowProposedApi: true });
    await writeAndWait(dst, vt);

    // Scrollback should exist in destination
    assert.ok(dst.buffer.active.baseY > 0, 'destination should have scrollback');

    src.dispose();
    dst.dispose();
  });

  it('includes title in output', async () => {
    const src = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
    const vt = serializeFullState(src, 'TestTitle', false);
    assert.ok(vt.includes('\x1b]2;TestTitle\x07'));
    src.dispose();
  });

  it('handles alternate buffer', async () => {
    const src = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
    await writeAndWait(src, '\x1b[?1049h'); // Switch to alternate buffer
    await writeAndWait(src, 'Alt content');
    const vt = serializeFullState(src, '', false);
    assert.ok(vt.includes('\x1b[?1049h'), 'should include alternate buffer switch');
    src.dispose();
  });

  it('includes exit-alternate sequence for normal mode', async () => {
    const src = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
    await writeAndWait(src, 'Normal content');
    const vt = serializeFullState(src, '', false);
    assert.ok(vt.includes('\x1b[?1049l'), 'should include exit-alternate for normal mode');
    assert.ok(!vt.includes('\x1b[?1049h'), 'should NOT include enter-alternate');
    src.dispose();
  });

  it('recovers client from alternate buffer stuck state', async () => {
    const src = new Terminal({ cols: 40, rows: 10, scrollback: 100, allowProposedApi: true });
    let data = '';
    for (let i = 1; i <= 15; i++) data += `line${i}\r\n`;
    await writeAndWait(src, data);
    assert.equal(src.buffer.active.type, 'normal');
    assert.ok(src.buffer.active.baseY > 0, 'source should have scrollback');

    const vt = serializeFullState(src, '', false);

    // Destination starts stuck in alternate mode (simulates the bug)
    const dst = new Terminal({ cols: 40, rows: 10, scrollback: 100, allowProposedApi: true });
    await writeAndWait(dst, '\x1b[?1049h');
    assert.equal(dst.buffer.active.type, 'alternate');

    // Apply with the same prefix the client STATE_FULL handler uses
    await writeAndWait(dst, '\x1b[?1049l\x1b[3J' + vt);

    assert.equal(dst.buffer.active.type, 'normal', 'should exit alternate buffer');
    assert.ok(dst.buffer.active.baseY > 0, 'should have scrollback after recovery');

    const srcSnap = takeSnapshot(src);
    const dstSnap = takeSnapshot(dst);
    const mismatches = compareSnapshots(srcSnap, dstSnap, 20);
    assert.equal(mismatches.length, 0, `mismatches: ${JSON.stringify(mismatches)}`);

    src.dispose();
    dst.dispose();
  });
});

describe('cursor visibility in diff', () => {
  it('omits cursor show when app has cursor hidden', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const prev = takeSnapshot(term, '', true);
    await writeAndWait(term, 'X');
    const curr = takeSnapshot(term, '', true);
    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null && diff !== '');
    assert.ok(diff.includes('\x1b[?25l'), 'should start with cursor hide');
    assert.ok(!diff.includes('\x1b[?25h'), 'should NOT show cursor when app hides it');
    term.dispose();
  });

  it('shows cursor when app has cursor visible', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const prev = takeSnapshot(term);
    await writeAndWait(term, 'X');
    const curr = takeSnapshot(term);
    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null && diff !== '');
    assert.ok(diff.endsWith('\x1b[?25h'), 'should end with cursor show');
    term.dispose();
  });

  it('emits cursor hide when visibility changes to hidden', () => {
    const prev = blankSnapshot(80, 24);
    prev.cursorHidden = false;
    const curr = blankSnapshot(80, 24);
    curr.cursorHidden = true;
    const diff = generateDiff(prev, curr);
    assert.equal(diff, '\x1b[?25l');
  });

  it('emits cursor show when visibility changes to visible', () => {
    const prev = blankSnapshot(80, 24);
    prev.cursorHidden = true;
    const curr = blankSnapshot(80, 24);
    curr.cursorHidden = false;
    const diff = generateDiff(prev, curr);
    assert.equal(diff, '\x1b[?25h');
  });

  it('emits nothing when cursor hidden and no changes', () => {
    const prev = blankSnapshot(80, 24);
    prev.cursorHidden = true;
    const curr = blankSnapshot(80, 24);
    curr.cursorHidden = true;
    const diff = generateDiff(prev, curr);
    assert.equal(diff, '');
  });
});

describe('serializeFullState cursor visibility', () => {
  it('omits cursor show when cursorHidden is true', async () => {
    const src = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
    await writeAndWait(src, 'Hello');
    const vt = serializeFullState(src, '', true);
    assert.ok(vt.startsWith('\x1b[?25l'), 'should start with cursor hide');
    assert.ok(!vt.includes('\x1b[?25h'), 'should NOT show cursor');
    src.dispose();
  });

  it('shows cursor when cursorHidden is false', async () => {
    const src = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
    await writeAndWait(src, 'Hello');
    const vt = serializeFullState(src, '', false);
    assert.ok(vt.endsWith('\x1b[?25h'), 'should end with cursor show');
    src.dispose();
  });
});

describe('wide characters', () => {
  it('handles CJK characters', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    await writeAndWait(term, '漢字');
    const snap = takeSnapshot(term);
    // Wide chars take 2 cells: char cell (width=2) + continuation cell (width=0)
    assert.equal(snap.cells[0]![0]!.char, '漢');
    assert.equal(snap.cells[0]![0]!.width, 2);
    assert.equal(snap.cells[0]![1]!.width, 0);
    assert.equal(snap.cells[0]![2]!.char, '字');
    assert.equal(snap.cells[0]![2]!.width, 2);
    term.dispose();
  });
});

describe('P16 color SGR emission', () => {
  it('emits standard SGR for low palette FG (0-7)', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const prev = takeSnapshot(term);
    await writeAndWait(term, '\x1b[31mR\x1b[0m'); // red = palette 1
    const curr = takeSnapshot(term);
    const diff = generateDiff(prev, curr)!;
    assert.ok(diff.includes(';31m'), 'should emit 31 for red FG');
    assert.ok(!diff.includes('38;5;'), 'should not use 256-color format for P16');
    term.dispose();
  });

  it('emits bright SGR for high palette FG (8-15)', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const prev = takeSnapshot(term);
    await writeAndWait(term, '\x1b[91mBR\x1b[0m'); // bright red = palette 9
    const curr = takeSnapshot(term);
    const diff = generateDiff(prev, curr)!;
    assert.ok(diff.includes(';91m'), 'should emit 91 for bright red FG');
    term.dispose();
  });

  it('emits standard SGR for low palette BG (0-7)', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const prev = takeSnapshot(term);
    await writeAndWait(term, '\x1b[44mB\x1b[0m'); // blue BG = palette 4
    const curr = takeSnapshot(term);
    const diff = generateDiff(prev, curr)!;
    assert.ok(diff.includes(';44m'), 'should emit 44 for blue BG');
    assert.ok(!diff.includes('48;5;'), 'should not use 256-color format for P16 BG');
    term.dispose();
  });

  it('still uses 256-color format for P256 colors', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const prev = takeSnapshot(term);
    await writeAndWait(term, '\x1b[38;5;196mR\x1b[0m'); // P256 red
    const curr = takeSnapshot(term);
    const diff = generateDiff(prev, curr)!;
    assert.ok(diff.includes('38;5;196'), 'should use 256-color format for P256');
    term.dispose();
  });
});

describe('serializeFullState SGR reset', () => {
  it('resets SGR before cursor positioning', async () => {
    const src = new Terminal({ cols: 40, rows: 10, scrollback: 100, allowProposedApi: true });
    await writeAndWait(src, '\x1b[32mGreen\x1b[0m');
    const vt = serializeFullState(src, '', false);
    // Find the final cursor positioning sequence (last \x1b[ before \x1b[?25h)
    const cursorShowIdx = vt.lastIndexOf('\x1b[?25h');
    const cursorPosIdx = vt.lastIndexOf('\x1b[', cursorShowIdx - 1);
    // There should be an \x1b[0m before the cursor position
    const sgrResetIdx = vt.lastIndexOf('\x1b[0m', cursorPosIdx);
    assert.ok(sgrResetIdx > 0, 'should have SGR reset before cursor positioning');
    src.dispose();
  });
});

describe('compareSnapshots', () => {
  it('returns empty array for identical snapshots', () => {
    const snap = blankSnapshot(80, 24);
    const mismatches = compareSnapshots(snap, snap, 10);
    assert.equal(mismatches.length, 0);
  });

  it('detects character differences', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const snap1 = takeSnapshot(term);
    await writeAndWait(term, 'A');
    const snap2 = takeSnapshot(term);
    const mismatches = compareSnapshots(snap1, snap2, 10);
    assert.ok(mismatches.length > 0);
    const charMismatch = mismatches.find(m => m.field === 'char' && m.row === 0 && m.col === 0);
    assert.ok(charMismatch);
    assert.equal(charMismatch.expected, ' ');
    assert.equal(charMismatch.actual, 'A');
    term.dispose();
  });

  it('detects color differences', async () => {
    const term1 = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const term2 = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    await writeAndWait(term1, '\x1b[32mG\x1b[0m');
    await writeAndWait(term2, '\x1b[31mR\x1b[0m');
    const snap1 = takeSnapshot(term1);
    const snap2 = takeSnapshot(term2);
    const mismatches = compareSnapshots(snap1, snap2, 10);
    assert.ok(mismatches.some(m => m.field === 'fg'), 'should detect fg color difference');
    assert.ok(mismatches.some(m => m.field === 'char'), 'should detect char difference');
    term1.dispose();
    term2.dispose();
  });

  it('respects maxMismatches limit', () => {
    const snap1 = blankSnapshot(80, 24);
    const snap2 = blankSnapshot(80, 24);
    for (let x = 0; x < 80; x++) {
      snap2.cells[0]![x]!.char = 'X';
    }
    const mismatches = compareSnapshots(snap1, snap2, 5);
    assert.equal(mismatches.length, 5);
  });
});

describe('serializeFullState BCE prevention', () => {
  it('empty lines after colored content have default bg', async () => {
    // Reproduce the exact scenario that caused color desync in production:
    // Colored lines followed by empty lines in scrollback → serializeFullState
    // writes colored cells, then \r\n scrolls with the last cell's SGR active.
    // Without the BCE fix, the new blank row inherits that background color.
    const src = new Terminal({ cols: 20, rows: 5, scrollback: 100, allowProposedApi: true });

    // Write colored content followed by empty lines to create scrollback
    await writeAndWait(src, '\x1b[48;5;237mColored bg\x1b[0m\r\n');
    await writeAndWait(src, '\r\n'); // empty line
    await writeAndWait(src, '\x1b[48;2;55;55;55mRGB bg\x1b[0m\r\n');
    await writeAndWait(src, '\r\n\r\n\r\n\r\n\r\n'); // push into scrollback

    const srcSnap = takeSnapshot(src);

    // Serialize and apply to shadow
    const vt = serializeFullState(src, '', false);
    const shadow = new Terminal({ cols: 20, rows: 5, scrollback: 100, allowProposedApi: true });
    await writeAndWait(shadow, '\x1b[3J' + vt);

    const shadowSnap = takeSnapshot(shadow);
    const mismatches = compareSnapshots(srcSnap, shadowSnap, 50);
    assert.equal(mismatches.length, 0,
      `BCE color leak: ${JSON.stringify(mismatches.slice(0, 5))}`);

    src.dispose();
    shadow.dispose();
  });

  it('no BCE leak when replaying with pre-existing SGR state', async () => {
    // Simulate self-heal scenario: shadow terminal has non-default SGR
    // from a previous frame, then receives \x1b[3J + STATE_FULL.
    const src = new Terminal({ cols: 20, rows: 5, scrollback: 100, allowProposedApi: true });
    for (let i = 0; i < 10; i++) {
      await writeAndWait(src, `\x1b[48;5;${200 + i}mLine ${i}\x1b[0m\r\n`);
    }

    const shadow = new Terminal({ cols: 20, rows: 5, scrollback: 100, allowProposedApi: true });
    // Set a non-default SGR on the shadow (simulating dirty state)
    await writeAndWait(shadow, '\x1b[48;5;196m');

    const vt = serializeFullState(src, '', false);
    await writeAndWait(shadow, '\x1b[3J' + vt);

    const srcSnap = takeSnapshot(src);
    const shadowSnap = takeSnapshot(shadow);
    const mismatches = compareSnapshots(srcSnap, shadowSnap, 50);
    assert.equal(mismatches.length, 0,
      `BCE leak with dirty SGR: ${JSON.stringify(mismatches.slice(0, 5))}`);

    src.dispose();
    shadow.dispose();
  });
});

describe('diff round-trip verification', () => {
  it('diff applied to shadow terminal matches source terminal', async () => {
    const src = new Terminal({ cols: 40, rows: 10, scrollback: 100, allowProposedApi: true });
    const shadow = new Terminal({ cols: 40, rows: 10, scrollback: 100, allowProposedApi: true });

    // Initialize both with the same STATE_FULL
    await writeAndWait(src, 'Initial content');
    const fullVt = serializeFullState(src, '', false);
    await writeAndWait(shadow, '\x1b[3J' + fullVt);

    // Make a change with colors
    const prev = takeSnapshot(src);
    await writeAndWait(src, '\x1b[32mGreen text\x1b[0m');
    const curr = takeSnapshot(src);

    const diff = generateDiff(prev, curr);
    assert.ok(diff !== null && diff !== '', 'should produce a diff');

    // Apply the diff to shadow
    await writeAndWait(shadow, diff);

    // Compare
    const shadowSnap = takeSnapshot(shadow);
    const mismatches = compareSnapshots(curr, shadowSnap, 20);
    assert.equal(mismatches.length, 0, `unexpected mismatches: ${JSON.stringify(mismatches)}`);

    src.dispose();
    shadow.dispose();
  });

  it('scroll diff applied to shadow matches source', async () => {
    const src = new Terminal({ cols: 40, rows: 5, scrollback: 100, allowProposedApi: true });
    const shadow = new Terminal({ cols: 40, rows: 5, scrollback: 100, allowProposedApi: true });

    // Write initial content with colors
    await writeAndWait(src, '\x1b[31mRed line 1\x1b[0m\r\n\x1b[32mGreen line 2\x1b[0m\r\n');
    const fullVt = serializeFullState(src, '', false);
    await writeAndWait(shadow, '\x1b[3J' + fullVt);

    const prev = takeSnapshot(src);

    // Cause a scroll with colored content
    await writeAndWait(src, '\x1b[34mBlue line 3\x1b[0m\r\n\x1b[35mMagenta line 4\x1b[0m\r\nline5\r\nline6\r\n');
    const curr = takeSnapshot(src);

    const diff = generateDiff(prev, curr);
    if (diff === null) {
      // Large scroll — use STATE_FULL
      const fullVt2 = serializeFullState(src, '', false);
      await writeAndWait(shadow, '\x1b[3J' + fullVt2);
    } else if (diff !== '') {
      await writeAndWait(shadow, diff);
    }

    const shadowSnap = takeSnapshot(shadow);
    const mismatches = compareSnapshots(curr, shadowSnap, 20);
    assert.equal(mismatches.length, 0, `scroll mismatches: ${JSON.stringify(mismatches)}`);

    src.dispose();
    shadow.dispose();
  });
});
