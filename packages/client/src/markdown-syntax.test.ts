import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  looksLikeMarkdown, isMarkdownFileName, isTableSeparator, highlightMarkdown, highlightInline,
} from './markdown-syntax.ts';

/** The mirror's invariant: highlighting never changes the text. */
function plain(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

describe('looksLikeMarkdown', () => {
  it('a GFM table alone is enough', () => {
    assert.equal(looksLikeMarkdown('| a | b |\n|---|:-:|\n| 1 | 2 |'), true);
    assert.equal(looksLikeMarkdown('a | b\n--- | ---\n1 | 2'), true);
  });
  it('a code fence alone is enough', () => {
    assert.equal(looksLikeMarkdown('see:\n```ts\nconst a = 1;\n```'), true);
    assert.equal(looksLikeMarkdown('~~~\nx\n~~~'), true);
  });
  it('needs two distinct weak signals', () => {
    assert.equal(looksLikeMarkdown('# Title\njust prose'), false);
    assert.equal(looksLikeMarkdown('- one\n- two\n- three'), false);
    assert.equal(looksLikeMarkdown('# Title\n- one'), true);
    assert.equal(looksLikeMarkdown('Use `pnpm` and **never** npm'), true);
    assert.equal(looksLikeMarkdown('> quoted\nsee [docs](https://x.dev)'), true);
  });
  it('plain prose and shell output stay plain', () => {
    assert.equal(looksLikeMarkdown('Fix the bug in the parser.\nIt crashes on empty input.'), false);
    assert.equal(looksLikeMarkdown('$ ls -la\ntotal 8\ndrwxr-xr-x  2 wei staff 64 a\n'), false);
    assert.equal(looksLikeMarkdown('cat a | grep b | wc -l'), false);
    assert.equal(looksLikeMarkdown(''), false);
  });
});

describe('isMarkdownFileName', () => {
  it('matches .md and .markdown only', () => {
    assert.equal(isMarkdownFileName('/tmp/README.md'), true);
    assert.equal(isMarkdownFileName('notes.MARKDOWN'), true);
    assert.equal(isMarkdownFileName('/tmp/claude-prompt-123'), false);
    assert.equal(isMarkdownFileName('a.mdx'), false);
  });
});

describe('isTableSeparator', () => {
  it('needs dashes and a pipe', () => {
    assert.equal(isTableSeparator('|---|---|'), true);
    assert.equal(isTableSeparator('| :-- | --: |'), true);
    assert.equal(isTableSeparator('|---|'), true);
    assert.equal(isTableSeparator('---'), false);
    assert.equal(isTableSeparator('| a | b |'), false);
  });
});

describe('highlightMarkdown', () => {
  const sample = [
    '# Heading with `code`',
    '',
    'Some **bold**, *em*, _em_, snake_case_name, a [link](https://x.dev) & <tag>.',
    '> quote with - dash',
    '- [ ] task',
    '1. item',
    '---',
    '| a | b |',
    '|---|---|',
    '| 1 | `|` |',
    '```ts',
    'const x = a ** b; // # not a heading',
    '```',
    'after \\*escaped\\* text',
    '``a ` b`` and ` unterminated',
    '',
  ].join('\n');

  it('never changes the text', () => {
    const html = highlightMarkdown(sample);
    assert.deepEqual(html.map(plain), sample.split('\n'));
  });

  it('carries fence state across lines', () => {
    const html = highlightMarkdown(sample);
    assert.match(html[11]!, /^<span class="md-codeblock">/);
    assert.match(html[12]!, /md-fence/);
    assert.match(html[13]!, /^after/);
  });

  it('a closing fence must match the opener', () => {
    const html = highlightMarkdown('````\n```\nstill code\n````\nout');
    assert.match(html[1]!, /md-codeblock/);
    assert.match(html[2]!, /md-codeblock/);
    assert.match(html[3]!, /md-fence/);
    assert.doesNotMatch(html[4]!, /md-/);
  });

  it('marks headings, lists, quotes, tables, rules', () => {
    const html = highlightMarkdown(sample);
    assert.match(html[0]!, /md-heading/);
    assert.match(html[0]!, /md-code/);
    assert.match(html[3]!, /md-quote/);
    assert.match(html[4]!, /md-list/);
    assert.match(html[5]!, /md-list/);
    assert.match(html[6]!, /md-hr/);
    assert.match(html[7]!, /md-pipe/);
    assert.match(html[8]!, /md-tablesep/);
  });

  it('inline: snake_case is not emphasis, escapes are literal', () => {
    assert.doesNotMatch(highlightInline('snake_case_name'), /md-em/);
    assert.doesNotMatch(highlightInline('\\*not em\\*'), /md-em/);
    assert.match(highlightInline('**b**'), /md-strong/);
    assert.match(highlightInline('[t](u)'), /md-link/);
  });

  it('5k lines tokenize fast', () => {
    const block = sample.split('\n');
    const lines: string[] = [];
    for (let i = 0; lines.length < 5000; i++) lines.push(`${block[i % block.length]} ${i}`);
    const text = lines.join('\n');
    const t0 = performance.now();
    highlightMarkdown(text);
    const cold = performance.now() - t0;
    const t1 = performance.now();
    highlightMarkdown(text + 'x');
    const warm = performance.now() - t1;
    console.log(`5k lines: cold ${cold.toFixed(1)} ms, warm ${warm.toFixed(1)} ms`);
    assert.ok(cold < 200, `cold ${cold} ms`);
    assert.ok(warm < 20, `warm ${warm} ms`);
  });
});
