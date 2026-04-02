// Normalize colon-separated SGR true-color sequences for xterm.js compatibility.
//
// Programs like nvim emit `\e[38:2:R:G:Bm` (colon sub-params, no color space
// field). xterm.js 5.5.0 expects `\e[38:2:<colorspace>:R:G:Bm` and misparses
// the shorter form — treating R as colorspace, G as R, B as G, and filling
// B=0. This shifts all colors toward yellow (zero blue channel).
//
// Fix: rewrite `38:2:R:G:B` and `48:2:R:G:B` (exactly 3 values after the 2)
// to semicolon-separated `38;2;R;G;B` / `48;2;R;G;B` which xterm.js handles
// correctly. The 4-value form `38:2:CS:R:G:B` (with color space) is already
// handled correctly by xterm.js and is left untouched.

// Matches a single colon-separated fg/bg color sub-param group:
//   (38|48) : 2 : <digits> : <digits> : <digits>
// but NOT when followed by another : <digit> (which would be the 4-value form).
const COLON_RGB_RE = /([34]8):2:(\d+):(\d+):(\d+)(?=[;m]|$)(?!:\d)/g;

/** Replace colon-separated RGB SGR params with semicolon-separated equivalents. */
function replaceColonRgb(params: string): string {
  return params.replace(COLON_RGB_RE, '$1;2;$2;$3;$4');
}

// Matches CSI SGR sequences: ESC [ <params> m
// params can contain digits, semicolons, and colons.
const SGR_SEQ_RE = /(\x1b\[)([0-9:;]+)(m)/g;

/**
 * Normalize SGR escape sequences in terminal output.
 * Rewrites colon-separated true-color sequences to semicolon-separated
 * format that xterm.js handles correctly.
 *
 * Only touches SGR sequences containing colon-separated color params;
 * all other data passes through unchanged.
 */
export function normalizeSgrColors(data: string): string {
  if (!data.includes(':2:')) return data;
  return data.replace(SGR_SEQ_RE, (_match, prefix: string, params: string, suffix: string) => {
    if (!params.includes(':2:')) return prefix + params + suffix;
    return prefix + replaceColonRgb(params) + suffix;
  });
}
