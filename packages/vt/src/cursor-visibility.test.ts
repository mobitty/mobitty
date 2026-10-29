import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import headlessPkg from '@xterm/headless';
const { Terminal } = headlessPkg;
import { trackCursorVisibility } from './cursor-visibility.ts';

function writeAndWait(terminal: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise(resolve => terminal.write(data, resolve));
}

describe('CursorVisibilityTracker', () => {
  it('initially has cursorHidden = false', () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const tracker = trackCursorVisibility(term);
    assert.equal(tracker.cursorHidden, false);
    tracker.dispose();
    term.dispose();
  });

  it('sets cursorHidden = true on DECTCEM hide', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const tracker = trackCursorVisibility(term);
    await writeAndWait(term, '\x1b[?25l');
    assert.equal(tracker.cursorHidden, true);
    tracker.dispose();
    term.dispose();
  });

  it('sets cursorHidden = false on DECTCEM show', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const tracker = trackCursorVisibility(term);
    await writeAndWait(term, '\x1b[?25l');
    assert.equal(tracker.cursorHidden, true);
    await writeAndWait(term, '\x1b[?25h');
    assert.equal(tracker.cursorHidden, false);
    tracker.dispose();
    term.dispose();
  });

  it('calls onChange when visibility changes', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    let callCount = 0;
    const tracker = trackCursorVisibility(term, () => { callCount++; });
    await writeAndWait(term, '\x1b[?25l');
    assert.equal(callCount, 1, 'should fire on hide');
    await writeAndWait(term, '\x1b[?25h');
    assert.equal(callCount, 2, 'should fire on show');
    // No change — should not fire
    await writeAndWait(term, '\x1b[?25h');
    assert.equal(callCount, 2, 'should not fire when state unchanged');
    tracker.dispose();
    term.dispose();
  });

  it('keeps the cursor hidden across RIS (ESC c), as xterm.js does', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const tracker = trackCursorVisibility(term);
    await writeAndWait(term, '\x1b[?25l');
    assert.equal(tracker.cursorHidden, true);
    await writeAndWait(term, '\x1bc');
    assert.equal(tracker.cursorHidden, true);
    tracker.dispose();
    term.dispose();
  });

  it('shows the cursor on DECSTR (CSI ! p)', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const tracker = trackCursorVisibility(term);
    await writeAndWait(term, '\x1b[?25l\x1b[!p');
    assert.equal(tracker.cursorHidden, false);
    tracker.dispose();
    term.dispose();
  });

  it('handles multi-param DECSET with mode 25', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const tracker = trackCursorVisibility(term);
    await writeAndWait(term, '\x1b[?25l');
    assert.equal(tracker.cursorHidden, true);
    // Multi-param show: CSI ? 25 ; 1 h
    await writeAndWait(term, '\x1b[?25;1h');
    assert.equal(tracker.cursorHidden, false);
    tracker.dispose();
    term.dispose();
  });

  it('keeps the cursor hidden across alternate-screen switches', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const tracker = trackCursorVisibility(term);
    await writeAndWait(term, '\x1b[?25l\x1b[?1049h');
    assert.equal(tracker.cursorHidden, true);
    await writeAndWait(term, '\x1b[?1049l');
    assert.equal(tracker.cursorHidden, true);
    tracker.dispose();
    term.dispose();
  });

  // The tracker must agree with xterm.js's own state (`modes.showCursor`),
  // which is what a client's xterm ends up with for the same stream.
  const sequences: ReadonlyArray<readonly [string, string]> = [
    ['hide then 1049h', '\x1b[?25l\x1b[?1049h'],
    ['hide, 1049h, 1049l', '\x1b[?25l\x1b[?1049h\x1b[?1049l'],
    ['hide then 1047h / 47h', '\x1b[?25l\x1b[?1047h\x1b[?47h'],
    ['hide then 1049l', '\x1b[?25l\x1b[?1049l'],
    ['1049h then hide then 1049l', '\x1b[?1049h\x1b[?25l\x1b[?1049l'],
    ['multi-param hide', '\x1b[?1049;25l'],
    ['multi-param show', '\x1b[?25l\x1b[?1;25h'],
    ['hide then RIS', '\x1b[?25l\x1bc'],
    ['hide then DECSTR', '\x1b[?25l\x1b[!p'],
  ];
  for (const [name, seq] of sequences) {
    it(`matches xterm.js modes.showCursor: ${name}`, async () => {
      const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const tracker = trackCursorVisibility(term);
      await writeAndWait(term, seq);
      assert.equal(tracker.cursorHidden, !term.modes.showCursor);
      tracker.dispose();
      term.dispose();
    });
  }

  it('dispose stops tracking', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    let callCount = 0;
    const tracker = trackCursorVisibility(term, () => { callCount++; });
    tracker.dispose();
    await writeAndWait(term, '\x1b[?25l');
    assert.equal(callCount, 0, 'should not fire after dispose');
    term.dispose();
  });
});
