import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import headlessPkg from '@xterm/headless';
const { Terminal } = headlessPkg;
import { parseOsc52, registerClipboardHandler, OSC52_MAX_DECODED_BYTES } from './osc-clipboard.ts';

function b64(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64');
}

function writeAndWait(terminal: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise(resolve => terminal.write(data, resolve));
}

describe('parseOsc52', () => {
  it('decodes a clipboard write', () => {
    assert.deepEqual(parseOsc52(`c;${b64('hello')}`), { ok: true, text: 'hello' });
  });

  it('decodes UTF-8 rather than latin-1', () => {
    const text = 'em—dash ✓ 日本語 🎉';
    assert.deepEqual(parseOsc52(`c;${b64(text)}`), { ok: true, text });
  });

  it('accepts an empty target', () => {
    assert.deepEqual(parseOsc52(`;${b64('hi')}`), { ok: true, text: 'hi' });
  });

  it('accepts the select target and combos containing c or s', () => {
    assert.deepEqual(parseOsc52(`s;${b64('hi')}`), { ok: true, text: 'hi' });
    assert.deepEqual(parseOsc52(`pc;${b64('hi')}`), { ok: true, text: 'hi' });
  });

  it('ignores primary/secondary selections', () => {
    assert.deepEqual(parseOsc52(`p;${b64('hi')}`), { ok: false, reason: 'target' });
    assert.deepEqual(parseOsc52(`q;${b64('hi')}`), { ok: false, reason: 'target' });
  });

  it('rejects a payload with no separator', () => {
    assert.deepEqual(parseOsc52('c'), { ok: false, reason: 'malformed' });
  });

  it('refuses clipboard queries', () => {
    assert.deepEqual(parseOsc52('c;?'), { ok: false, reason: 'query' });
  });

  it('ignores an empty payload (would clear the clipboard)', () => {
    assert.deepEqual(parseOsc52('c;'), { ok: false, reason: 'empty' });
  });

  it('rejects malformed base64', () => {
    assert.deepEqual(parseOsc52('c;not*valid'), { ok: false, reason: 'bad-base64' });
    // Node's base64 decoder silently drops trailing garbage; we must not.
    assert.deepEqual(parseOsc52('c;aGVsbG8'), { ok: false, reason: 'bad-base64' });
  });

  it('rejects payloads over the decoded cap', () => {
    const oversized = 'A'.repeat(Math.ceil((OSC52_MAX_DECODED_BYTES + 1024) / 3) * 4);
    assert.deepEqual(parseOsc52(`c;${oversized}`), { ok: false, reason: 'too-large' });
  });

  it('accepts a payload just under the cap', () => {
    const result = parseOsc52(`c;${b64('x'.repeat(OSC52_MAX_DECODED_BYTES - 8))}`);
    assert.equal(result.ok, true);
  });
});

describe('registerClipboardHandler', () => {
  it('fires on a BEL-terminated OSC 52 from the PTY stream', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const copies: string[] = [];
    registerClipboardHandler(term, text => copies.push(text));

    await writeAndWait(term, `\x1b]52;c;${b64('from-tui')}\x07`);

    assert.deepEqual(copies, ['from-tui']);
    term.dispose();
  });

  it('fires on the ST-terminated form', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const copies: string[] = [];
    registerClipboardHandler(term, text => copies.push(text));

    await writeAndWait(term, `\x1b]52;c;${b64('st-form')}\x1b\\`);

    assert.deepEqual(copies, ['st-form']);
    term.dispose();
  });

  it('reassembles a sequence split across writes', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const copies: string[] = [];
    registerClipboardHandler(term, text => copies.push(text));

    const payload = b64('split across chunks');
    await writeAndWait(term, `\x1b]52;c;${payload.slice(0, 5)}`);
    await writeAndWait(term, `${payload.slice(5)}\x07`);

    assert.deepEqual(copies, ['split across chunks']);
    term.dispose();
  });

  it('consumes the sequence instead of printing it', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    registerClipboardHandler(term, () => {});

    await writeAndWait(term, `\x1b]52;c;${b64('quiet')}\x07ok`);

    assert.equal(term.buffer.active.getLine(0)?.translateToString(true), 'ok');
    term.dispose();
  });

  it('reports why a sequence was dropped', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const copies: string[] = [];
    const rejects: string[] = [];
    registerClipboardHandler(term, t => copies.push(t), reason => rejects.push(reason));

    await writeAndWait(term, '\x1b]52;c;?\x07');

    assert.deepEqual(copies, []);
    assert.deepEqual(rejects, ['query']);
    term.dispose();
  });
});
