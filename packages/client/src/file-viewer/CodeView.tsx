import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ThemedToken } from 'shiki/core';
import { cn } from '@/lib/utils';
import type { LangId } from './languages.ts';

/** Larger text renders unhighlighted: tokenizing is synchronous once the
 *  grammar is loaded, and a multi-megabyte file would freeze the WebView. */
export const MAX_HIGHLIGHT_BYTES = 512 * 1024;

interface CodeViewProps {
  code: string;
  lang: LangId | null;
  lineNumbers?: boolean;
  className?: string;
}

/** Syntax-highlighted code. Paints the plain text immediately, then swaps in
 *  tokens once Shiki and the grammar have loaded. */
export function CodeView({ code: raw, lang, lineNumbers = true, className }: CodeViewProps) {
  // A trailing newline ends the last line; it does not start an empty one.
  const code = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  const [highlighted, setHighlighted] = useState<{ code: string; tokens: ThemedToken[][] } | null>(null);
  const canHighlight = lang !== null && code.length <= MAX_HIGHLIGHT_BYTES;

  useEffect(() => {
    if (!canHighlight || lang === null) return;
    let cancelled = false;
    import('./highlighter')
      .then(m => m.tokenize(code, lang))
      .then(tokens => { if (!cancelled) setHighlighted({ code, tokens }); })
      .catch(() => { /* stay plain */ });
    return () => { cancelled = true; };
  }, [code, lang, canHighlight]);

  const tokens = highlighted?.code === code && canHighlight ? highlighted.tokens : null;
  const lines = useMemo(() => (tokens ? null : code.split('\n')), [code, tokens]);
  const lineCount = tokens ? tokens.length : lines!.length;
  const gutterCh = String(lineCount).length + 1;

  return (
    <div className={cn('fv-code font-mono text-[13px] leading-5 py-3 min-w-fit', className)}>
      {Array.from({ length: lineCount }, (_, i) => (
        <div key={i} className="flex">
          {lineNumbers && (
            <span
              className="shrink-0 select-none text-right pr-4 text-muted-foreground/70"
              style={{ width: `${gutterCh + 2}ch` }}
            >
              {i + 1}
            </span>
          )}
          <span className={cn('whitespace-pre pr-4', !lineNumbers && 'pl-4')}>
            {tokens
              ? tokens[i]!.map((token, j) => (
                <span key={j} className="fv-tok" style={token.htmlStyle as CSSProperties | undefined}>{token.content}</span>
              ))
              : (lines![i] || ' ')}
            {tokens && tokens[i]!.length === 0 ? ' ' : null}
          </span>
        </div>
      ))}
    </div>
  );
}
