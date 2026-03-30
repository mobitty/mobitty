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

  it('resets on RIS (ESC c)', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const tracker = trackCursorVisibility(term);
    await writeAndWait(term, '\x1b[?25l');
    assert.equal(tracker.cursorHidden, true);
    await writeAndWait(term, '\x1bc');
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

  it('handles alt screen enter (1049h) as cursor visible', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const tracker = trackCursorVisibility(term);
    await writeAndWait(term, '\x1b[?25l');
    assert.equal(tracker.cursorHidden, true);
    await writeAndWait(term, '\x1b[?1049h');
    assert.equal(tracker.cursorHidden, false);
    tracker.dispose();
    term.dispose();
  });

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
