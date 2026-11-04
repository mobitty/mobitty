import { useLayoutEffect, useRef } from 'react';
import { highlightMarkdown } from '@/markdown-syntax';
import { cn } from '@/lib/utils';

/** The newline that ends line i-1 is carried at the start of line i's span, so
 *  a line's DOM never depends on whether it happens to be the last one. */
function lineHtml(lines: string[], i: number): string {
  return i === 0 ? lines[0]! : '\n' + lines[i]!;
}

/** Replace only the run of line spans that changed: a keystroke touches one
 *  line, and rewriting a 5k-line `innerHTML` per keystroke would not keep up. */
function patchLines(pre: HTMLPreElement, sentinel: Text, prev: string[], next: string[]): void {
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && lineHtml(prev, start) === lineHtml(next, start)) start++;
  let end = 0;
  while (
    end < minLen - start
    && lineHtml(prev, prev.length - 1 - end) === lineHtml(next, next.length - 1 - end)
  ) end++;

  const children = pre.childNodes;
  for (let i = prev.length - end - 1; i >= start; i--) children[i]!.remove();
  const before = children[start] ?? sentinel;
  const frag = document.createDocumentFragment();
  for (let i = start; i < next.length - end; i++) {
    const el = document.createElement('span');
    el.innerHTML = lineHtml(next, i);
    frag.appendChild(el);
  }
  pre.insertBefore(frag, before);
}

/** `md-metrics` zeroes the border, so this is the scrollbar alone. */
function scrollbarWidth(ta: HTMLTextAreaElement): string {
  return `${Math.max(0, ta.offsetWidth - ta.clientWidth)}px`;
}

interface MarkdownMirrorProps {
  text: string;
  /** The textarea it mirrors; null until mounted. */
  textarea: HTMLTextAreaElement | null;
  /** Must match the textarea's wrap setting, or the lines drift apart. */
  wrap: boolean;
}

/**
 * Highlighted copy of the textarea's text, painted *behind* it. The textarea
 * keeps the caret, selection, IME and edit history; its own glyphs are
 * transparent, so what the user reads is this `<pre>`. Both share the
 * `md-metrics` class, so they wrap identically; this component keeps the rest
 * in step — scroll position and the textarea's scrollbar width.
 */
export function MarkdownMirror({ text, textarea, wrap }: MarkdownMirrorProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const linesRef = useRef<string[]>([]);
  const sentinelRef = useRef<Text | null>(null);

  // Scroll, and the width a classic (non-overlay) scrollbar takes out of the
  // textarea's content box — the pre has none, so without this it would wrap
  // lines a few characters later than the textarea does.
  useLayoutEffect(() => {
    const ta = textarea;
    const pre = preRef.current;
    if (!ta || !pre) return;
    const syncScroll = (): void => {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    };
    const syncMetrics = (): void => {
      pre.style.setProperty('--md-sbw', scrollbarWidth(ta));
      syncScroll();
    };
    syncMetrics();
    const ro = new ResizeObserver(syncMetrics);
    ro.observe(ta);
    ta.addEventListener('scroll', syncScroll, { passive: true });
    return () => {
      ro.disconnect();
      ta.removeEventListener('scroll', syncScroll);
    };
  }, [textarea]);

  // Patched before paint, so the visible text never trails the textarea.
  useLayoutEffect(() => {
    const pre = preRef.current;
    const ta = textarea;
    if (!pre) return;
    if (sentinelRef.current === null) {
      // Gives a trailing empty line height: "a\n" alone ends the pre's last
      // line box at the newline, where the textarea still shows a line.
      sentinelRef.current = document.createTextNode(' ');
      pre.appendChild(sentinelRef.current);
    }
    const next = highlightMarkdown(text);
    patchLines(pre, sentinelRef.current, linesRef.current, next);
    linesRef.current = next;
    if (ta) {
      // Growing past the fold can add a scrollbar without resizing the box.
      pre.style.setProperty('--md-sbw', scrollbarWidth(ta));
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
  }, [text, textarea, wrap]);

  return (
    <pre
      ref={preRef}
      aria-hidden
      className={cn(
        'md-metrics md-mirror font-mono text-sm absolute inset-0 overflow-hidden pointer-events-none select-none text-foreground',
        !wrap && 'md-nowrap',
      )}
    />
  );
}
