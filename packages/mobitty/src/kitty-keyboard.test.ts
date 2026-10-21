import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import headlessPkg from '@xterm/headless';
const { Terminal } = headlessPkg;
import { trackKittyKeyboard } from './kitty-keyboard.ts';
import type { KittyKeyboardTracker } from './kitty-keyboard.ts';

function writeAndWait(terminal: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise(resolve => terminal.write(data, resolve));
}

describe('trackKittyKeyboard', () => {
  let term: InstanceType<typeof Terminal>;
  let tracker: KittyKeyboardTracker;
  let replies: string[];
  let changes: number[];

  beforeEach(() => {
    term = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
    replies = [];
    changes = [];
    tracker = trackKittyKeyboard(term, {
      reply: d => replies.push(d),
      onChange: f => changes.push(f),
    });
  });

  afterEach(() => {
    tracker.dispose();
    term.dispose();
  });

  it('starts at 0', () => {
    assert.equal(tracker.flags, 0);
  });

  it('push sets flags and pop restores the previous value', async () => {
    await writeAndWait(term, '\x1b[>1u');
    assert.equal(tracker.flags, 1);
    await writeAndWait(term, '\x1b[>5u');
    assert.equal(tracker.flags, 5);
    await writeAndWait(term, '\x1b[<u');
    assert.equal(tracker.flags, 1);
    await writeAndWait(term, '\x1b[<u');
    assert.equal(tracker.flags, 0);
  });

  it('pop honours the count and an emptied stack leaves 0', async () => {
    await writeAndWait(term, '\x1b[>1u\x1b[>3u\x1b[>7u');
    await writeAndWait(term, '\x1b[<2u');
    assert.equal(tracker.flags, 1, 'popping two of three entries restores the first push');
    await writeAndWait(term, '\x1b[<9u');
    assert.equal(tracker.flags, 0, 'popping past the bottom leaves 0');
    await writeAndWait(term, '\x1b[=5u\x1b[<u');
    assert.equal(tracker.flags, 0, 'pop on an empty stack resets to 0');
  });

  it('evicts the oldest entry past 16', async () => {
    // Push 17 values on top of the initial 0: stack holds 16 entries, the
    // initial 0 is evicted.
    for (let i = 1; i <= 17; i++) await writeAndWait(term, `\x1b[>${i}u`);
    assert.equal(tracker.flags, 17);
    await writeAndWait(term, '\x1b[<15u');
    assert.equal(tracker.flags, 2, 'fifteen pops land on the value pushed second');
    await writeAndWait(term, '\x1b[<u');
    assert.equal(tracker.flags, 0, 'the last pop empties the stack (the initial 0 was evicted)');
  });

  it('set mode 1 assigns, 2 ORs, 3 AND-NOTs', async () => {
    await writeAndWait(term, '\x1b[=5u');
    assert.equal(tracker.flags, 5, 'default mode is assign');
    await writeAndWait(term, '\x1b[=8;2u');
    assert.equal(tracker.flags, 13);
    await writeAndWait(term, '\x1b[=4;3u');
    assert.equal(tracker.flags, 9);
    await writeAndWait(term, '\x1b[=2;1u');
    assert.equal(tracker.flags, 2);
  });

  it('keeps separate state per screen across ?1049h/l', async () => {
    await writeAndWait(term, '\x1b[>1u');
    await writeAndWait(term, '\x1b[?1049h');
    assert.equal(tracker.flags, 0, 'alternate screen starts at its own 0');
    await writeAndWait(term, '\x1b[>5u');
    assert.equal(tracker.flags, 5);
    await writeAndWait(term, '\x1b[?1049l');
    assert.equal(tracker.flags, 1, 'normal screen keeps its flags');
    await writeAndWait(term, '\x1b[<u');
    assert.equal(tracker.flags, 0);
    await writeAndWait(term, '\x1b[?1049h');
    assert.equal(tracker.flags, 5, 'alternate screen keeps its flags');
    await writeAndWait(term, '\x1b[<u');
    assert.equal(tracker.flags, 0, 'alternate stack pops independently');
  });

  it('RIS resets both screens', async () => {
    await writeAndWait(term, '\x1b[>1u\x1b[?1049h\x1b[>5u');
    await writeAndWait(term, '\x1bc');
    assert.equal(tracker.flags, 0);
    await writeAndWait(term, '\x1b[<u');
    assert.equal(tracker.flags, 0, 'stack cleared');
    await writeAndWait(term, '\x1b[?1049h');
    assert.equal(tracker.flags, 0);
  });

  it('DECSTR resets both screens', async () => {
    await writeAndWait(term, '\x1b[>1u\x1b[?1049h\x1b[>5u');
    await writeAndWait(term, '\x1b[!p');
    assert.equal(tracker.flags, 0);
    await writeAndWait(term, '\x1b[?1049l');
    assert.equal(tracker.flags, 0, 'normal screen reset too');
  });

  it('answers the query exactly once with the current flags', async () => {
    // Even if headless.onData is subscribed, the built-in handler must not add
    // a second reply.
    const dataEvents: string[] = [];
    const sub = term.onData(d => dataEvents.push(d));
    await writeAndWait(term, '\x1b[?u');
    assert.deepEqual(replies, ['\x1b[?0u']);
    await writeAndWait(term, '\x1b[?1049h\x1b[>5u\x1b[?u');
    assert.deepEqual(replies, ['\x1b[?0u', '\x1b[?5u']);
    assert.deepEqual(dataEvents, [], 'no reply through headless.onData');
    sub.dispose();
  });

  it('fires onChange only when the active flags change', async () => {
    await writeAndWait(term, '\x1b[=5u');
    await writeAndWait(term, '\x1b[=5u');
    await writeAndWait(term, '\x1b[=1;2u');
    await writeAndWait(term, '\x1b[>5u');
    await writeAndWait(term, '\x1b[<u');
    await writeAndWait(term, '\x1b[=0u');
    await writeAndWait(term, '\x1bc');
    assert.deepEqual(changes, [5, 0]);
  });

  it('dispose stops tracking', async () => {
    tracker.dispose();
    await writeAndWait(term, '\x1b[>5u\x1b[?u');
    assert.equal(tracker.flags, 0);
    assert.deepEqual(replies, []);
  });
});
