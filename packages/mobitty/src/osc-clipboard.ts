// OSC 52 — application-initiated clipboard write.
// Format: `\e]52;<targets>;<base64>\a` (ST-terminated form is equivalent).
//
// This has to live on the server. Under the always-diff state sync model
// (docs/done-design-ssp.md) the PTY byte stream never reaches the browser —
// the headless terminal absorbs it and the client only receives VT cell
// diffs — so a parser handler on the client's xterm would never see OSC 52.
// We intercept it here and relay the decoded text over the WebSocket.
// See docs/done-design-osc-52-copy.md.

import type { Terminal } from '@xterm/headless';

/** Cap on the *decoded* payload. xterm's parser already limits the raw OSC
 *  payload to 10 MB; we cap lower so a runaway TUI can't smear a multi-MB
 *  blob across the user's clipboard. 1 MB covers any realistic editor yank. */
export const OSC52_MAX_DECODED_BYTES = 1024 * 1024;

/** Why a sequence was dropped. Surfaced for logging only. */
export type Osc52Reject =
  | 'malformed'    // no `;` separating target from payload
  | 'target'       // primary/secondary selection — we have no X selections to write
  | 'query'        // `?` payload: a clipboard *read* request, refused on privacy grounds
  | 'empty'        // empty payload would clear the clipboard
  | 'bad-base64'
  | 'too-large';

export type Osc52Parse =
  | { ok: true; text: string }
  | { ok: false; reason: Osc52Reject };

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Parse the body of an OSC 52 sequence (the part after `52;`).
 *
 * Targets are `c` (clipboard), `p` (primary), `q` (secondary) and `s` (select).
 * We map any combination containing `c` or `s` onto the system clipboard and
 * ignore pure `p`/`q`. An empty target is also the clipboard, matching the
 * de-facto behavior of other emulators.
 */
export function parseOsc52(data: string): Osc52Parse {
  const semi = data.indexOf(';');
  if (semi < 0) return { ok: false, reason: 'malformed' };

  const target = data.slice(0, semi);
  if (target !== '' && !/[cs]/.test(target)) return { ok: false, reason: 'target' };

  const payload = data.slice(semi + 1);
  // `ESC ] 52 ; c ; ? BEL` asks us to *send back* the clipboard. Refused:
  // leaking the user's clipboard to a remote process is the OSC 52 footgun.
  if (payload === '?') return { ok: false, reason: 'query' };
  if (payload === '') return { ok: false, reason: 'empty' };
  if (payload.length % 4 !== 0 || !BASE64_RE.test(payload)) return { ok: false, reason: 'bad-base64' };

  // Check the decoded size from the base64 length so an oversized payload is
  // rejected without allocating it.
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const decodedBytes = (payload.length / 4) * 3 - padding;
  if (decodedBytes > OSC52_MAX_DECODED_BYTES) return { ok: false, reason: 'too-large' };

  return { ok: true, text: Buffer.from(payload, 'base64').toString('utf-8') };
}

type ClipboardCallback = (text: string) => void;
type RejectCallback = (reason: Osc52Reject, payloadLength: number) => void;

/**
 * Register an OSC 52 handler on a headless terminal.
 * `onCopy` fires with the decoded UTF-8 text each time a program in the
 * session asks for a clipboard write. Returns true from the handler — nothing
 * downstream handles OSC 52, and the sequence must not reach the buffer.
 */
export function registerClipboardHandler(
  terminal: Terminal,
  onCopy: ClipboardCallback,
  onReject?: RejectCallback,
): void {
  terminal.parser.registerOscHandler(52, (data: string) => {
    const result = parseOsc52(data);
    if (result.ok) onCopy(result.text);
    else onReject?.(result.reason, data.length);
    return true;
  });
}
