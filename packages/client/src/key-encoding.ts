// Byte encoding for soft keys, sticky modifiers and gesture-driven keys.
//
// With no kitty keyboard flags active this is mobitty's long-standing legacy
// encoding. Once an app enables the kitty keyboard protocol (the server
// replays its flags to the client as `CSI = N ; 1 u`), it mirrors xterm.js
// 6.1's `KittyKeyboard.evaluate`, so a soft key and the matching hardware key
// produce identical bytes — in particular Ctrl/Shift/Alt+Enter become
// `CSI 13 ; m u`, which legacy encoding cannot express at all.
// See docs/todo-bug-ctrl-enter-alt-buffer.md.
//
// Type-only imports keep this module runnable under
// `node --test --experimental-strip-types` (see
// docs/todo-bug-client-tests-unrunnable.md).
import type { ModifierFlags, VirtualKey } from './softkey-types';

export type EncodableKey = VirtualKey | 'enter' | 'backspace' | { char: string };

export interface KeyEncodingContext {
  /** Active kitty keyboard flags (0 = protocol off). */
  kittyFlags: number;
  /** DECCKM (application cursor keys). Ignored once kitty flags are on. */
  appCursorKeys: boolean;
}

const KITTY_DISAMBIGUATE = 0b00001;
const KITTY_REPORT_EVENT_TYPES = 0b00010;
const KITTY_REPORT_ALTERNATE_KEYS = 0b00100;
const KITTY_REPORT_ALL_KEYS = 0b01000;
const KITTY_REPORT_ASSOCIATED_TEXT = 0b10000;

const ESC = '\x1b';
const CSI = '\x1b[';

function hasModifiers(m: ModifierFlags): boolean {
  return m.ctrl || m.alt || m.shift;
}

/** xterm / kitty modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). */
function csiModifier(m: ModifierFlags): number {
  return 1 + (m.shift ? 1 : 0) + (m.alt ? 2 : 0) + (m.ctrl ? 4 : 0);
}

// --- Legacy encoding (moved verbatim from terminal-core.ts) ---

function applyShift(char: string): string {
  if (/^[a-z]$/.test(char)) return char.toUpperCase();
  return char;
}

function applyCtrl(char: string): string {
  if (char.length !== 1) return char;
  const code = char.charCodeAt(0);
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  if (code >= 65 && code <= 90) return String.fromCharCode(code - 64);
  switch (char) {
    case ' ': case '@': return String.fromCharCode(0);
    case '[': return String.fromCharCode(27);
    case '\\': return String.fromCharCode(28);
    case ']': return String.fromCharCode(29);
    case '^': return String.fromCharCode(30);
    case '_': return String.fromCharCode(31);
    case '?': return String.fromCharCode(127);
    default: return char;
  }
}

function legacyChar(char: string, m: ModifierFlags): string {
  if (!hasModifiers(m)) return char;
  let value = m.shift ? applyShift(char) : char;
  if (m.ctrl) value = applyCtrl(value);
  if (m.alt) value = `${ESC}${value}`;
  return value;
}

function legacyVirtual(key: VirtualKey, m: ModifierFlags, appMode: boolean): string {
  if (!hasModifiers(m)) {
    const keyMap: Record<VirtualKey, string> = {
      esc: ESC, tab: '\t',
      up: appMode ? '\x1bOA' : '\x1b[A',
      down: appMode ? '\x1bOB' : '\x1b[B',
      right: appMode ? '\x1bOC' : '\x1b[C',
      left: appMode ? '\x1bOD' : '\x1b[D',
      home: appMode ? '\x1bOH' : '\x1b[H',
      end: appMode ? '\x1bOF' : '\x1b[F',
      pageup: '\x1b[5~', pagedown: '\x1b[6~',
    };
    return keyMap[key] ?? '';
  }
  const n = csiModifier(m);
  const modKeyMap: Record<VirtualKey, string> = {
    esc: legacyChar(ESC, m),
    tab: m.shift && !m.ctrl && !m.alt ? '\x1b[Z' : `\x1b[1;${n}I`,
    up: `\x1b[1;${n}A`, down: `\x1b[1;${n}B`,
    right: `\x1b[1;${n}C`, left: `\x1b[1;${n}D`,
    home: `\x1b[1;${n}H`, end: `\x1b[1;${n}F`,
    pageup: `\x1b[5;${n}~`, pagedown: `\x1b[6;${n}~`,
  };
  return modKeyMap[key] ?? '';
}

function legacyEncode(key: EncodableKey, m: ModifierFlags, ctx: KeyEncodingContext): string {
  if (typeof key === 'object') return legacyChar(key.char, m);
  if (key === 'enter') return legacyChar('\r', m);
  if (key === 'backspace') return legacyChar('\x7f', m);
  return legacyVirtual(key, m, ctx.appCursorKeys);
}

// --- Kitty encoding (mirrors xterm.js 6.1 KittyKeyboard.evaluate, press events) ---

const CSI_LETTER: Partial<Record<VirtualKey, string>> = {
  up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F',
};
const CSI_TILDE: Partial<Record<VirtualKey, number>> = { pageup: 5, pagedown: 6 };

/** Bytes that soft keys use for the kitty "functional" keys. */
const FUNCTIONAL_CHAR: Record<string, 'enter' | 'tab' | 'backspace' | 'esc'> = {
  '\r': 'enter', '\t': 'tab', '\x7f': 'backspace', '\x1b': 'esc',
};
const FUNCTIONAL_CODE = { enter: 13, tab: 9, backspace: 127, esc: 27 } as const;
const LEGACY_BYTE = { enter: '\r', tab: '\t', backspace: '\x7f' } as const;

function csiU(code: number | string, m: ModifierFlags, text?: number): string {
  const n = csiModifier(m);
  let seq = `${CSI}${code}`;
  if (n > 1 || text !== undefined) seq += `;${n > 1 ? n : ''}`;
  if (text !== undefined) seq += `;${text}`;
  return `${seq}u`;
}

function kittyEncode(key: EncodableKey, m: ModifierFlags, flags: number): string | null {
  const allKeys = !!(flags & KITTY_REPORT_ALL_KEYS);
  const n = csiModifier(m);

  let named: VirtualKey | 'enter' | 'backspace' | null = null;
  let char: string | null = null;
  if (typeof key === 'object') {
    const fn = FUNCTIONAL_CHAR[key.char];
    if (fn) named = fn;
    else char = key.char;
  } else {
    named = key;
  }

  if (named !== null) {
    const letter = CSI_LETTER[named as VirtualKey];
    if (letter) return n > 1 ? `${CSI}1;${n}${letter}` : `${CSI}${letter}`;
    const tilde = CSI_TILDE[named as VirtualKey];
    if (tilde !== undefined) return n > 1 ? `${CSI}${tilde};${n}~` : `${CSI}${tilde}~`;
    if (named === 'esc') return csiU(FUNCTIONAL_CODE.esc, m);
    if (named === 'enter' || named === 'tab' || named === 'backspace') {
      // Unmodified Enter/Tab/Backspace keep their legacy bytes (so `reset`
      // can still be typed); any modifier, Shift included, selects CSI u.
      if (allKeys || n > 1) return csiU(FUNCTIONAL_CODE[named], m);
      return LEGACY_BYTE[named];
    }
    return null;
  }

  // Text-producing key. Only a single code point can be kitty-encoded; other
  // control bytes (e.g. a custom key sending `\x03`) keep legacy encoding.
  const cps = Array.from(char!);
  if (cps.length !== 1) return null;
  const cp = cps[0]!.codePointAt(0)!;
  if (cp < 0x20 || cp === 0x7f) return null;

  const text = m.shift ? applyShift(cps[0]!) : cps[0]!;
  // Shift-only text stays text; any other modifier selects CSI u.
  const useCsiU = allKeys || m.ctrl || m.alt;
  if (!useCsiU) return text;

  // Base key: the unshifted code point, letters lowercased.
  const base = cp >= 65 && cp <= 90 ? cp + 32 : cp;
  let code: number | string = base;
  if ((flags & KITTY_REPORT_ALTERNATE_KEYS) && m.shift) {
    code = `${base}:${text.codePointAt(0)}`;
  }
  const assoc = (flags & KITTY_REPORT_ASSOCIATED_TEXT) && !m.ctrl ? text.codePointAt(0) : undefined;
  return csiU(code, m, assoc);
}

/** Whether `flags` change key encoding at all. Like xterm.js, event-type
 *  reporting implies disambiguation; flags with neither (e.g. only 4) fall
 *  back to legacy rather than xterm's behavior of sending nothing for Esc. */
function kittyActive(flags: number): boolean {
  return !!(flags & (KITTY_DISAMBIGUATE | KITTY_REPORT_EVENT_TYPES | KITTY_REPORT_ALL_KEYS));
}

/** Encode one key press with the given modifiers. */
export function encodeKey(key: EncodableKey, mods: ModifierFlags, ctx: KeyEncodingContext): string {
  if (kittyActive(ctx.kittyFlags)) {
    const out = kittyEncode(key, mods, ctx.kittyFlags);
    if (out !== null) return out;
  }
  return legacyEncode(key, mods, ctx);
}

/** Apply sticky modifiers to text the terminal produced (xterm `onData`, e.g.
 *  `\r` from the iOS keyboard's Return): re-encode the first code point and
 *  pass the rest through. Under kitty flags, data that is already an escape
 *  sequence (xterm's own CSI u, arrows) passes through unchanged rather than
 *  being split. */
export function encodeTextWithModifiers(data: string, mods: ModifierFlags, ctx: KeyEncodingContext): string {
  if (!data || !hasModifiers(mods)) return data;
  if (kittyActive(ctx.kittyFlags) && data.length > 1 && data.startsWith(ESC)) return data;
  const chars = Array.from(data);
  const first = chars.shift();
  if (!first) return data;
  return encodeKey({ char: first }, mods, ctx) + chars.join('');
}
