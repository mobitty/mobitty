import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import headlessPkg from '@xterm/headless';
const { Terminal } = headlessPkg;
import { hexToXColorSpec, registerColorQueryHandlers } from './osc-color-query.ts';
import type { OscColorConfig } from './osc-color-query.ts';

function writeAndWait(terminal: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise(resolve => terminal.write(data, resolve));
}

describe('hexToXColorSpec', () => {
  it('converts lowercase hex', () => {
    assert.equal(hexToXColorSpec('#2b2b2b'), 'rgb:2b/2b/2b');
  });

  it('converts black', () => {
    assert.equal(hexToXColorSpec('#000000'), 'rgb:00/00/00');
  });

  it('converts white (uppercase input)', () => {
    assert.equal(hexToXColorSpec('#FFFFFF'), 'rgb:ff/ff/ff');
  });

  it('converts mixed-case hex', () => {
    assert.equal(hexToXColorSpec('#D2d2D2'), 'rgb:d2/d2/d2');
  });

  it('converts distinct RGB values', () => {
    assert.equal(hexToXColorSpec('#1a2b3c'), 'rgb:1a/2b/3c');
  });
});

describe('registerColorQueryHandlers', () => {
  it('responds to OSC 11 background query', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const responses: string[] = [];
    const config: OscColorConfig = {
      foreground: '#d2d2d2',
      background: '#2b2b2b',
      cursor: '#adadad',
      writeToPty: (r) => responses.push(r),
    };
    const tracker = registerColorQueryHandlers(term, config);

    await writeAndWait(term, '\x1b]11;?\x07');
    assert.equal(responses.length, 1);
    assert.equal(responses[0], '\x1b]11;rgb:2b/2b/2b\x07');

    tracker.dispose();
    term.dispose();
  });

  it('responds to OSC 10 foreground query', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const responses: string[] = [];
    const config: OscColorConfig = {
      foreground: '#d2d2d2',
      background: '#2b2b2b',
      cursor: '#adadad',
      writeToPty: (r) => responses.push(r),
    };
    const tracker = registerColorQueryHandlers(term, config);

    await writeAndWait(term, '\x1b]10;?\x07');
    assert.equal(responses.length, 1);
    assert.equal(responses[0], '\x1b]10;rgb:d2/d2/d2\x07');

    tracker.dispose();
    term.dispose();
  });

  it('responds to OSC 12 cursor query', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const responses: string[] = [];
    const config: OscColorConfig = {
      foreground: '#d2d2d2',
      background: '#2b2b2b',
      cursor: '#adadad',
      writeToPty: (r) => responses.push(r),
    };
    const tracker = registerColorQueryHandlers(term, config);

    await writeAndWait(term, '\x1b]12;?\x07');
    assert.equal(responses.length, 1);
    assert.equal(responses[0], '\x1b]12;rgb:ad/ad/ad\x07');

    tracker.dispose();
    term.dispose();
  });

  it('does not respond to non-query OSC 11 data', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const responses: string[] = [];
    const config: OscColorConfig = {
      foreground: '#d2d2d2',
      background: '#2b2b2b',
      cursor: '#adadad',
      writeToPty: (r) => responses.push(r),
    };
    const tracker = registerColorQueryHandlers(term, config);

    // SET command, not a query
    await writeAndWait(term, '\x1b]11;#ffffff\x07');
    assert.equal(responses.length, 0);

    tracker.dispose();
    term.dispose();
  });

  it('updateColors changes subsequent responses', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const responses: string[] = [];
    const config: OscColorConfig = {
      foreground: '#d2d2d2',
      background: '#2b2b2b',
      cursor: '#adadad',
      writeToPty: (r) => responses.push(r),
    };
    const tracker = registerColorQueryHandlers(term, config);

    await writeAndWait(term, '\x1b]11;?\x07');
    assert.equal(responses[0], '\x1b]11;rgb:2b/2b/2b\x07');

    tracker.updateColors('#f8f8f2', '#282a36', '#f8f8f2');

    await writeAndWait(term, '\x1b]11;?\x07');
    assert.equal(responses[1], '\x1b]11;rgb:28/2a/36\x07');

    await writeAndWait(term, '\x1b]10;?\x07');
    assert.equal(responses[2], '\x1b]10;rgb:f8/f8/f2\x07');

    tracker.dispose();
    term.dispose();
  });

  it('responds with ST terminator query too', async () => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const responses: string[] = [];
    const config: OscColorConfig = {
      foreground: '#d2d2d2',
      background: '#2b2b2b',
      cursor: '#adadad',
      writeToPty: (r) => responses.push(r),
    };
    const tracker = registerColorQueryHandlers(term, config);

    // nvim typically uses ST (\e\\) instead of BEL
    await writeAndWait(term, '\x1b]11;?\x1b\\');
    assert.equal(responses.length, 1);
    assert.equal(responses[0], '\x1b]11;rgb:2b/2b/2b\x07');

    tracker.dispose();
    term.dispose();
  });
});
