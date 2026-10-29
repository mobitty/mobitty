// Markdown support for the remote editor: content detection, and the
// highlighter behind its backdrop mirror. Pure and dependency-free so it runs
// under `node --test`. See `todo-feat-remote-editor-markdown.md`.

// ── Detection ───────────────────────────────────────────────────────────────
// Decides whether the editor switches on highlighting and the Format button.
// Run on open and on a paste into an empty editor — never per keystroke.

/** Scanning stops after this many characters: detection only has to be right
 *  about the kind of document, and the head of it says that. */
const SCAN_LIMIT = 200_000;

const FENCE = /^ {0,3}(```|~~~)/;
const HEADING = /^ {0,3}#{1,6}\s+\S/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\S/;
const BLOCKQUOTE = /^ {0,3}>/;
const BOLD = /\*\*[^*\s][^*]*\*\*|__[^_\s][^_]*__/;
const LINK = /\[[^\]\n]+\]\([^)\s]+\)/;
const INLINE_CODE = /`[^`\n]+`/;

/** A GFM table delimiter row: cells of `-` with optional `:` alignment
 *  colons, separated by at least one pipe. */
export function isTableSeparator(line: string): boolean {
  if (!line.includes('|') || !line.includes('-')) return false;
  return /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(line)
    || /^\s*\|\s*:?-+:?\s*\|\s*$/.test(line);
}

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().length > 1;
}

type WeakSignal = 'heading' | 'list' | 'quote' | 'bold' | 'link' | 'code';

/** True when `text` reads as markdown: one strong signal (a GFM table or a
 *  code fence) or at least two distinct weak ones. */
export function looksLikeMarkdown(text: string): boolean {
  const lines = (text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text).split('\n');
  const weak = new Set<WeakSignal>();
  let prev = '';
  for (const line of lines) {
    if (FENCE.test(line)) return true;
    if (isTableSeparator(line) && isTableRow(prev)) return true;
    if (HEADING.test(line)) weak.add('heading');
    else if (LIST_ITEM.test(line)) weak.add('list');
    else if (BLOCKQUOTE.test(line)) weak.add('quote');
    if (BOLD.test(line)) weak.add('bold');
    if (LINK.test(line)) weak.add('link');
    if (INLINE_CODE.test(line)) weak.add('code');
    if (weak.size >= 2) return true;
    prev = line;
  }
  return false;
}

export function isMarkdownFileName(filePath: string): boolean {
  return /\.(?:md|markdown)$/i.test(filePath);
}

// ── Highlighting ────────────────────────────────────────────────────────────
// Synchronous, line-based markdown highlighter for the remote editor's
// backdrop mirror. It colors markup and never changes the text: stripping the
// tags and unescaping the entities of a line's HTML gives back the line exactly,
// which is what keeps the mirror aligned with the transparent textarea above
// it. Colors only — no weight, style or size changes, which could alter glyph
// advances in the monospace font. See `todo-feat-remote-editor-markdown.md`.
//
// Each keystroke re-highlights the whole document, so per-line results are
// memoized by (fence state, line text): only edited lines are tokenized again.

/** Fence state at the start of a line: '' outside a fenced block, otherwise
 *  the opening run (e.g. "```" or "~~~~"), which a closing fence must match. */
export type FenceState = string;

export interface HighlightedLine {
  html: string;
  /** Fence state at the start of the next line. */
  next: FenceState;
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function span(cls: string, inner: string): string {
  return inner === '' ? '' : `<span class="md-${cls}">${inner}</span>`;
}

const OPEN_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING_LINE = /^( {0,3})(#{1,6})(?=[ \t]|$)(.*)$/;
const QUOTE = /^( {0,3}(?:>[ \t]?)+)(.*)$/;
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\](?=[ \t]))?(.*)$/;
const LINK_AT = /^(!?\[)([^\]\n]*)(\]\()([^)\s]*(?:\s+"[^"\n]*")?)(\))/;

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c);
}

/** Inline markup: code spans, links, strong/emphasis, table pipes, escapes. */
export function highlightInline(s: string): string {
  let out = '';
  let text = '';
  const flush = (): void => { out += esc(text); text = ''; };
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < n) {
      text += s.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '`') {
      let k = i;
      while (s[k] === '`') k++;
      const run = s.slice(i, k);
      // Closing run must be exactly as long as the opening one.
      let close = s.indexOf(run, k);
      while (close !== -1 && s[close + run.length] === '`') {
        let e = close;
        while (s[e] === '`') e++;
        close = s.indexOf(run, e);
      }
      if (close !== -1 && close > k) {
        flush();
        out += span('code', esc(s.slice(i, close + run.length)));
        i = close + run.length;
      } else {
        text += run;
        i = k;
      }
      continue;
    }
    if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const m = LINK_AT.exec(s.slice(i));
      if (m) {
        flush();
        out += span('punct', esc(m[1]!)) + span('link', highlightInline(m[2]!))
          + span('punct', esc(m[3]!)) + span('url', esc(m[4]!)) + span('punct', esc(m[5]!));
        i += m[0].length;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      let k = i;
      while (s[k] === c && k - i < 3) k++;
      const run = s.slice(i, k);
      const after = s[k];
      // `_` inside a word (snake_case) is not emphasis.
      const opens = after !== undefined && !/\s/.test(after)
        && !(c === '_' && isWordChar(s[i - 1]));
      if (opens) {
        let close = s.indexOf(run, k + 1);
        while (close !== -1 && (/\s/.test(s[close - 1] ?? ' ')
          || (c === '_' && isWordChar(s[close + run.length])))) {
          close = s.indexOf(run, close + 1);
        }
        if (close !== -1) {
          flush();
          const cls = run.length === 1 ? 'em' : 'strong';
          out += `<span class="md-${cls}">${span('punct', esc(run))}${highlightInline(s.slice(k, close))}${span('punct', esc(run))}</span>`;
          i = close + run.length;
          continue;
        }
      }
      text += run;
      i = k;
      continue;
    }
    if (c === '|') {
      flush();
      out += span('pipe', '|');
      i++;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

function highlightLineUncached(line: string, fence: FenceState): HighlightedLine {
  if (fence !== '') {
    const t = line.trim();
    const isClose = t.length >= fence.length && /^ {0,3}(`+|~+)[ \t]*$/.test(line)
      && t[0] === fence[0] && t.replace(/[ \t]/g, '').length >= fence.length;
    if (isClose) return { html: span('fence', esc(line)), next: '' };
    return { html: span('codeblock', esc(line)), next: fence };
  }

  const f = OPEN_FENCE.exec(line);
  // A backtick fence's info string may not contain backticks.
  if (f && !(f[2]![0] === '`' && f[3]!.includes('`'))) {
    return {
      html: esc(f[1]!) + span('fence', esc(f[2]!)) + span('info', esc(f[3]!)),
      next: f[2]!,
    };
  }

  if (HR.test(line)) return { html: span('hr', esc(line)), next: '' };

  const h = HEADING_LINE.exec(line);
  if (h) {
    return {
      html: esc(h[1]!) + `<span class="md-heading">${span('punct', esc(h[2]!))}${highlightInline(h[3]!)}</span>`,
      next: '',
    };
  }

  if (isTableSeparator(line)) {
    return { html: span('tablesep', esc(line).replace(/\|/g, '<span class="md-pipe">|</span>')), next: '' };
  }

  let html = '';
  let rest = line;
  const q = QUOTE.exec(rest);
  if (q) {
    html += span('quote', esc(q[1]!));
    rest = q[2]!;
  }
  const l = LIST.exec(rest);
  if (l) {
    html += esc(l[1]!) + span('list', esc(l[2]!)) + esc(l[3]!) + span('list', esc(l[4] ?? ''));
    rest = l[5]!;
  }
  html += highlightInline(rest);
  return { html, next: '' };
}

const CACHE_LIMIT = 20_000;
const cache = new Map<string, HighlightedLine>();

export function highlightLine(line: string, fence: FenceState): HighlightedLine {
  const key = fence + '\u0000' + line;
  let hit = cache.get(key);
  if (hit === undefined) {
    hit = highlightLineUncached(line, fence);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, hit);
  }
  return hit;
}

/** HTML for each line of `text` (split on '\n'), fence state carried across. */
export function highlightMarkdown(text: string): string[] {
  const lines = text.split('\n');
  const out = new Array<string>(lines.length);
  let fence: FenceState = '';
  for (let i = 0; i < lines.length; i++) {
    const r = highlightLine(lines[i]!, fence);
    out[i] = r.html;
    fence = r.next;
  }
  return out;
}
