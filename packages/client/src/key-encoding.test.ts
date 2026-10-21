import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeKey, encodeTextWithModifiers } from './key-encoding.ts';
import type { EncodableKey } from './key-encoding.ts';

// Table tests for soft-key encoding. Legacy rows pin mobitty's pre-kitty
// output; kitty rows pin xterm.js 6.1's KittyKeyboard.evaluate for the same
// key on a hardware keyboard. See docs/todo-bug-ctrl-enter-alt-buffer.md.

type Mod = 'ctrl' | 'alt' | 'shift';
const mods = (...m: Mod[]) => ({ ctrl: m.includes('ctrl'), alt: m.includes('alt'), shift: m.includes('shift') });

interface Row {
  key: EncodableKey;
  mods: Mod[];
  flags: number;
  decckm?: boolean;
  out: string;
}

const c = (char: string) => ({ char });

const rows: Row[] = [
  // --- Legacy (flags 0): today's output ---
  { key: c('\r'), mods: [], flags: 0, out: '\r' },
  { key: c('\r'), mods: ['ctrl'], flags: 0, out: '\r' },
  { key: c('\r'), mods: ['shift'], flags: 0, out: '\r' },
  { key: c('\r'), mods: ['alt'], flags: 0, out: '\x1b\r' },
  { key: 'enter', mods: ['ctrl'], flags: 0, out: '\r' },
  { key: 'tab', mods: [], flags: 0, out: '\t' },
  { key: 'tab', mods: ['shift'], flags: 0, out: '\x1b[Z' },
  { key: 'tab', mods: ['ctrl'], flags: 0, out: '\x1b[1;5I' },
  { key: 'esc', mods: [], flags: 0, out: '\x1b' },
  { key: 'esc', mods: ['alt'], flags: 0, out: '\x1b\x1b' },
  { key: 'up', mods: [], flags: 0, out: '\x1b[A' },
  { key: 'up', mods: [], flags: 0, decckm: true, out: '\x1bOA' },
  { key: 'home', mods: [], flags: 0, decckm: true, out: '\x1bOH' },
  { key: 'up', mods: ['ctrl'], flags: 0, out: '\x1b[1;5A' },
  { key: 'pageup', mods: [], flags: 0, out: '\x1b[5~' },
  { key: 'pagedown', mods: ['shift'], flags: 0, out: '\x1b[6;2~' },
  { key: c('c'), mods: ['ctrl'], flags: 0, out: '\x03' },
  { key: c('x'), mods: ['alt'], flags: 0, out: '\x1bx' },
  { key: c('a'), mods: ['shift'], flags: 0, out: 'A' },
  { key: c('a'), mods: ['ctrl', 'shift'], flags: 0, out: '\x01' },
  { key: c(' '), mods: ['ctrl'], flags: 0, out: '\x00' },
  { key: c('a'), mods: [], flags: 0, out: 'a' },
  // Custom combos can't name Enter yet; the literal text passes through.
  { key: c('Enter'), mods: ['ctrl'], flags: 0, out: 'Enter' },

  // --- Kitty, disambiguate (+ alternate keys = Claude Code's 5) ---
  { key: c('\r'), mods: [], flags: 5, out: '\r' },
  { key: c('\r'), mods: ['ctrl'], flags: 5, out: '\x1b[13;5u' },
  { key: c('\r'), mods: ['ctrl'], flags: 1, out: '\x1b[13;5u' },
  { key: 'enter', mods: ['ctrl'], flags: 5, out: '\x1b[13;5u' },
  { key: c('\r'), mods: ['shift'], flags: 5, out: '\x1b[13;2u' },
  { key: c('\r'), mods: ['alt'], flags: 5, out: '\x1b[13;3u' },
  { key: 'esc', mods: [], flags: 5, out: '\x1b[27u' },
  { key: c('\x1b'), mods: [], flags: 1, out: '\x1b[27u' },
  { key: 'esc', mods: ['shift'], flags: 1, out: '\x1b[27;2u' },
  { key: c('c'), mods: ['ctrl'], flags: 5, out: '\x1b[99;5u' },
  { key: c('x'), mods: ['alt'], flags: 5, out: '\x1b[120;3u' },
  { key: c('a'), mods: ['shift'], flags: 5, out: 'A' },
  { key: c('a'), mods: ['ctrl', 'shift'], flags: 1, out: '\x1b[97;6u' },
  { key: c('a'), mods: ['ctrl', 'shift'], flags: 5, out: '\x1b[97:65;6u' },
  { key: c('A'), mods: ['ctrl'], flags: 5, out: '\x1b[97;5u' },
  { key: 'tab', mods: [], flags: 5, out: '\t' },
  { key: 'tab', mods: ['shift'], flags: 5, out: '\x1b[9;2u' },
  { key: c('\t'), mods: ['ctrl'], flags: 5, out: '\x1b[9;5u' },
  { key: 'backspace', mods: [], flags: 5, out: '\x7f' },
  { key: c('\x7f'), mods: ['ctrl'], flags: 5, out: '\x1b[127;5u' },
  { key: c(' '), mods: ['ctrl'], flags: 5, out: '\x1b[32;5u' },
  { key: c(' '), mods: ['shift'], flags: 5, out: ' ' },
  { key: c(' '), mods: [], flags: 5, out: ' ' },
  { key: 'up', mods: [], flags: 5, decckm: true, out: '\x1b[A' },
  { key: 'up', mods: [], flags: 5, out: '\x1b[A' },
  { key: 'end', mods: [], flags: 5, decckm: true, out: '\x1b[F' },
  { key: 'left', mods: ['ctrl'], flags: 5, out: '\x1b[1;5D' },
  { key: 'pageup', mods: [], flags: 5, out: '\x1b[5~' },
  { key: 'pagedown', mods: ['ctrl'], flags: 5, out: '\x1b[6;5~' },
  { key: c('a'), mods: [], flags: 5, out: 'a' },
  // Multi-code-point text and other C0 bytes keep legacy encoding.
  { key: c('Enter'), mods: ['ctrl'], flags: 5, out: 'Enter' },
  { key: c('\x03'), mods: [], flags: 5, out: '\x03' },

  // --- Kitty, report all keys as escape codes ---
  { key: c('a'), mods: [], flags: 8, out: '\x1b[97u' },
  { key: c('a'), mods: ['shift'], flags: 8, out: '\x1b[97;2u' },
  { key: c('a'), mods: ['shift'], flags: 12, out: '\x1b[97:65;2u' },
  { key: c('\r'), mods: [], flags: 8, out: '\x1b[13u' },
  { key: c('a'), mods: [], flags: 24, out: '\x1b[97;;97u' },

  // --- Flags that do not change encoding fall back to legacy ---
  { key: 'esc', mods: [], flags: 4, out: '\x1b' },
  { key: c('\r'), mods: ['ctrl'], flags: 4, out: '\r' },
  // Event-type reporting implies disambiguation (as in xterm.js).
  { key: c('\r'), mods: ['ctrl'], flags: 2, out: '\x1b[13;5u' },
];

const label = (r: Row) =>
  `${[...r.mods, typeof r.key === 'object' ? JSON.stringify(r.key.char) : r.key].join('+')}` +
  ` flags=${r.flags}${r.decckm ? ' DECCKM' : ''} → ${JSON.stringify(r.out)}`;

describe('encodeKey', () => {
  for (const r of rows) {
    it(label(r), () => {
      assert.equal(encodeKey(r.key, mods(...r.mods), { kittyFlags: r.flags, appCursorKeys: !!r.decckm }), r.out);
    });
  }
});

describe('encodeTextWithModifiers', () => {
  const ctx = (kittyFlags: number) => ({ kittyFlags, appCursorKeys: false });

  it('returns the data unchanged without modifiers', () => {
    assert.equal(encodeTextWithModifiers('\r', mods(), ctx(5)), '\r');
  });

  it('re-encodes the first code point and passes the rest through', () => {
    assert.equal(encodeTextWithModifiers('\r', mods('ctrl'), ctx(5)), '\x1b[13;5u');
    assert.equal(encodeTextWithModifiers('ab', mods('ctrl'), ctx(0)), '\x01b');
    assert.equal(encodeTextWithModifiers('ab', mods('ctrl'), ctx(5)), '\x1b[97;5ub');
    assert.equal(encodeTextWithModifiers('\r', mods('ctrl'), ctx(0)), '\r');
  });

  it('passes an already-encoded escape sequence through under kitty flags', () => {
    assert.equal(encodeTextWithModifiers('\x1b[27u', mods('ctrl'), ctx(5)), '\x1b[27u');
  });
});
