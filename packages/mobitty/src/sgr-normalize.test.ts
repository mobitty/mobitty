import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import headlessPkg from '@xterm/headless';
const { Terminal } = headlessPkg;
import { normalizeSgrColors } from './sgr-normalize.ts';

function writeAndWait(terminal: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise(resolve => terminal.write(data, resolve));
}

describe('normalizeSgrColors', () => {
  it('rewrites 48:2:R:G:B to 48;2;R;G;B', () => {
    assert.equal(
      normalizeSgrColors('\x1b[48:2:20:22:27m'),
      '\x1b[48;2;20;22;27m',
    );
  });

  it('rewrites 38:2:R:G:B to 38;2;R;G;B', () => {
    assert.equal(
      normalizeSgrColors('\x1b[38:2:224:226:234m'),
      '\x1b[38;2;224;226;234m',
    );
  });

  it('leaves 48:2::R:G:B (with colorspace) unchanged', () => {
    assert.equal(
      normalizeSgrColors('\x1b[48:2::20:22:27m'),
      '\x1b[48:2::20:22:27m',
    );
  });

  it('leaves 48:2:0:R:G:B (explicit colorspace) unchanged', () => {
    assert.equal(
      normalizeSgrColors('\x1b[48:2:0:20:22:27m'),
      '\x1b[48:2:0:20:22:27m',
    );
  });

  it('leaves semicolon-separated format unchanged', () => {
    assert.equal(
      normalizeSgrColors('\x1b[48;2;20;22;27m'),
      '\x1b[48;2;20;22;27m',
    );
  });

  it('handles mixed params in one SGR sequence', () => {
    assert.equal(
      normalizeSgrColors('\x1b[1;38:2:224:226:234;48:2:20:22:27m'),
      '\x1b[1;38;2;224;226;234;48;2;20;22;27m',
    );
  });

  it('handles multiple SGR sequences in one string', () => {
    const input = '\x1b[38:2:10:20:30mhello\x1b[48:2:40:50:60mworld\x1b[0m';
    const expected = '\x1b[38;2;10;20;30mhello\x1b[48;2;40;50;60mworld\x1b[0m';
    assert.equal(normalizeSgrColors(input), expected);
  });

  it('passes through data without :2: unchanged', () => {
    const input = 'hello world \x1b[1;31m red \x1b[0m normal';
    assert.equal(normalizeSgrColors(input), input);
  });

  it('passes through non-SGR escape sequences unchanged', () => {
    const input = '\x1b[?25l\x1b[H\x1b[2J';
    assert.equal(normalizeSgrColors(input), input);
  });
});

describe('normalizeSgrColors integration with xterm.js', () => {
  it('fixes nvim colon-separated colors in headless terminal', async () => {
    const term = new Terminal({ cols: 80, rows: 4, allowProposedApi: true });

    // nvim sends 48:2:20:22:27 — without normalization, xterm.js misparses this
    const raw = '\x1b[48:2:20:22:27m TEST \x1b[0m';
    const normalized = normalizeSgrColors(raw);

    await writeAndWait(term, normalized);

    const cell = term.buffer.active.getLine(0)!.getCell(1)!;
    const bg = cell.getBgColor();
    assert.equal((bg >> 16) & 0xff, 20, 'R should be 20');
    assert.equal((bg >> 8) & 0xff, 22, 'G should be 22');
    assert.equal(bg & 0xff, 27, 'B should be 27');

    term.dispose();
  });
});
