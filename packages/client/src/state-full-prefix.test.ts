import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import xtermPkg from '@xterm/xterm';
import { STATE_FULL_PREFIX } from './state-full-prefix.ts';

const { Terminal } = xtermPkg;
type Term = InstanceType<typeof Terminal>;

function write(term: Term, data: string): Promise<void> {
  return new Promise(resolve => term.write(data, resolve));
}

// Every non-default mode `serializeModes` (@mobitty/vt diff.ts) can emit,
// on the alternate screen, as a previous session's TUI could leave them.
const STALE_MODES = '\x1b[?1049h'
  + '\x1b[?1h\x1b[?66h\x1b[?2004h\x1b[4h\x1b[?6h\x1b[?45h\x1b[?1004h\x1b[?7l'
  + '\x1b[?1003h\x1b[?1006h';

describe('STATE_FULL_PREFIX', () => {
  it('returns every mode serializeModes sets to its default', async () => {
    const fresh = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
    const term = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
    await write(term, STALE_MODES);
    assert.notDeepEqual(term.modes, fresh.modes);
    await write(term, STATE_FULL_PREFIX);
    assert.deepEqual(term.modes, fresh.modes);
    assert.equal(term.buffer.active.type, 'normal');
    term.dispose();
    fresh.dispose();
  });
});
