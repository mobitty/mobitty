import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage shim — must be installed before importing the modules
// under test, which touch `localStorage` at call time (not import time, but the
// shim is cheap to install up front and keeps the two test files uniform).

interface MockStorage {
  store: Map<string, string>;
  /** When set, `setItem` throws for payloads at or above this length. */
  quota: number | null;
  length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

function createMockStorage(): MockStorage {
  const store = new Map<string, string>();
  const storage: MockStorage = {
    store,
    quota: null,
    get length() { return store.size; },
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) {
      if (storage.quota !== null && value.length >= storage.quota) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.set(key, value);
    },
    removeItem(key) { store.delete(key); },
    key(index) { return [...store.keys()][index] ?? null; },
  };
  return storage;
}

let mock = createMockStorage();
(globalThis as unknown as { localStorage: MockStorage }).localStorage = mock;

const {
  listEditorHistory, pushEditorHistory, deleteEditorHistoryEntry, clearEditorHistory,
  formatRelativeTime,
} = await import('./editor-history.ts');
const {
  getRemoteEditorDraft, setRemoteEditorDraft, clearRemoteEditorDraft,
  takeStaleRemoteEditorDrafts,
} = await import('./remote-editor-storage.ts');

function reset(): void {
  mock = createMockStorage();
  (globalThis as unknown as { localStorage: MockStorage }).localStorage = mock;
}

function push(text: string, extra: Partial<{ outcome: 'saved' | 'cancelled'; baseline: string }> = {}): boolean {
  return pushEditorHistory({
    text,
    fileName: 'claude-prompt.md',
    sessionLabel: 'zsh',
    outcome: extra.outcome ?? 'cancelled',
    baseline: extra.baseline,
  });
}

describe('editor history ring', () => {
  beforeEach(reset);

  it('starts empty and records a push', () => {
    assert.deepEqual(listEditorHistory(), []);
    assert.equal(push('hello'), true);
    const entries = listEditorHistory();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].text, 'hello');
    assert.equal(entries[0].outcome, 'cancelled');
    assert.equal(entries[0].sessionLabel, 'zsh');
  });

  it('lists newest first', () => {
    push('first');
    push('second');
    push('third');
    assert.deepEqual(listEditorHistory().map(e => e.text), ['third', 'second', 'first']);
  });

  it('skips whitespace-only text', () => {
    assert.equal(push('   \n\t '), false);
    assert.equal(listEditorHistory().length, 0);
  });

  it('skips text identical to the server-supplied baseline', () => {
    assert.equal(push('unchanged', { baseline: 'unchanged' }), false);
    assert.equal(listEditorHistory().length, 0);
  });

  it('refreshes rather than duplicates when the newest entry matches', () => {
    push('same', { outcome: 'cancelled' });
    const firstId = listEditorHistory()[0].id;
    push('same', { outcome: 'saved' });
    const entries = listEditorHistory();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, firstId);
    assert.equal(entries[0].outcome, 'saved');
  });

  it('caps the ring at 20 entries, evicting the oldest', () => {
    for (let i = 0; i < 25; i++) push(`draft ${i}`);
    const entries = listEditorHistory();
    assert.equal(entries.length, 20);
    assert.equal(entries[0].text, 'draft 24');
    assert.equal(entries[19].text, 'draft 5');
  });

  it('refuses a single entry over the per-entry byte cap', () => {
    assert.equal(push('x'.repeat(256_001)), false);
    assert.equal(listEditorHistory().length, 0);
  });

  it('evicts oldest entries to stay under the total byte cap', () => {
    // 10 × ~200 KB would be 2 MB; the 1.5 MB cap must shed the oldest.
    for (let i = 0; i < 10; i++) push(`${i}`.padEnd(200_000, 'x'));
    const entries = listEditorHistory();
    assert.ok(entries.length < 10, `expected eviction, kept ${entries.length}`);
    assert.ok(entries.length > 0);
    assert.equal(entries[0].text.startsWith('9'), true);
  });

  it('deletes a single entry by id', () => {
    push('keep me');
    push('drop me');
    deleteEditorHistoryEntry(listEditorHistory()[0].id);
    assert.deepEqual(listEditorHistory().map(e => e.text), ['keep me']);
  });

  it('clears every entry', () => {
    push('a');
    push('b');
    clearEditorHistory();
    assert.deepEqual(listEditorHistory(), []);
  });

  it('reads a corrupt payload as empty instead of throwing', () => {
    mock.store.set('mobitty-editor-history', '{not json');
    assert.deepEqual(listEditorHistory(), []);
    // And a push over the corruption still works.
    assert.equal(push('recovered'), true);
    assert.deepEqual(listEditorHistory().map(e => e.text), ['recovered']);
  });

  it('reads a foreign schema version as empty', () => {
    mock.store.set('mobitty-editor-history', JSON.stringify({ v: 99, entries: [{ text: 'x' }] }));
    assert.deepEqual(listEditorHistory(), []);
  });

  it('drops malformed entries but keeps well-formed neighbours', () => {
    mock.store.set('mobitty-editor-history', JSON.stringify({
      v: 1,
      entries: [
        { id: 'a', text: 'good', savedAt: 5, fileName: 'f', sessionLabel: '', outcome: 'saved' },
        { id: 'b', text: 'bad' },
      ],
    }));
    assert.deepEqual(listEditorHistory().map(e => e.text), ['good']);
  });

  it('sheds the oldest half and retries when the quota bites', () => {
    for (let i = 0; i < 6; i++) push(`draft ${i}`);
    const before = listEditorHistory().length;
    assert.equal(before, 6);
    // Any write of the full 7-entry ring now fails; the half-size retry fits.
    mock.quota = JSON.stringify({ v: 1, entries: listEditorHistory() }).length + 20;
    push('draft 6');
    const after = listEditorHistory();
    assert.ok(after.length < 7, `expected shedding, kept ${after.length}`);
    assert.equal(after[0].text, 'draft 6');
  });

  it('survives localStorage being unavailable', () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      get length(): number { throw new Error('denied'); },
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
      key() { throw new Error('denied'); },
    };
    assert.deepEqual(listEditorHistory(), []);
    assert.doesNotThrow(() => push('anything'));
    assert.doesNotThrow(() => clearEditorHistory());
    assert.doesNotThrow(() => deleteEditorHistoryEntry('nope'));
  });
});

describe('remote editor draft records', () => {
  beforeEach(reset);

  it('round-trips a draft', () => {
    setRemoteEditorDraft('/tmp/a.md', 'typed');
    assert.equal(getRemoteEditorDraft('/tmp/a.md'), 'typed');
  });

  it('returns null for an absent draft', () => {
    assert.equal(getRemoteEditorDraft('/tmp/missing.md'), null);
  });

  it('reads a legacy bare-string draft written by an older build', () => {
    mock.store.set('mobitty-remote-editor:/tmp/legacy.md', 'plain text');
    assert.equal(getRemoteEditorDraft('/tmp/legacy.md'), 'plain text');
  });

  it('clears a draft', () => {
    setRemoteEditorDraft('/tmp/a.md', 'typed');
    clearRemoteEditorDraft('/tmp/a.md');
    assert.equal(getRemoteEditorDraft('/tmp/a.md'), null);
  });

  it('skips persisting a draft over the byte cap', () => {
    setRemoteEditorDraft('/tmp/big.md', 'x'.repeat(1_000_001));
    assert.equal(getRemoteEditorDraft('/tmp/big.md'), null);
  });

  it('leaves fresh drafts alone when sweeping', () => {
    setRemoteEditorDraft('/tmp/fresh.md', 'still editing');
    assert.deepEqual(takeStaleRemoteEditorDrafts(60_000), []);
    assert.equal(getRemoteEditorDraft('/tmp/fresh.md'), 'still editing');
  });

  it('takes and removes drafts older than the cutoff', () => {
    mock.store.set(
      'mobitty-remote-editor:/tmp/old.md',
      JSON.stringify({ t: Date.now() - 120_000, s: 'abandoned' }),
    );
    setRemoteEditorDraft('/tmp/fresh.md', 'still editing');
    const stale = takeStaleRemoteEditorDrafts(60_000);
    assert.deepEqual(stale, [{ filePath: '/tmp/old.md', text: 'abandoned' }]);
    assert.equal(getRemoteEditorDraft('/tmp/old.md'), null);
    assert.equal(getRemoteEditorDraft('/tmp/fresh.md'), 'still editing');
  });

  it('treats an untimestamped legacy draft as stale', () => {
    mock.store.set('mobitty-remote-editor:/tmp/legacy.md', 'from an old build');
    const stale = takeStaleRemoteEditorDrafts(60_000);
    assert.deepEqual(stale, [{ filePath: '/tmp/legacy.md', text: 'from an old build' }]);
    assert.equal(mock.store.has('mobitty-remote-editor:/tmp/legacy.md'), false);
  });

  it('ignores unrelated localStorage keys while sweeping', () => {
    mock.store.set('mobitty-batch-input', 'untouched');
    mock.store.set('mobitty-session-id', 'untouched');
    assert.deepEqual(takeStaleRemoteEditorDrafts(0), []);
    assert.equal(mock.store.get('mobitty-batch-input'), 'untouched');
    assert.equal(mock.store.get('mobitty-session-id'), 'untouched');
  });
});

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000;

  it('labels sub-minute deltas', () => {
    assert.equal(formatRelativeTime(now - 30_000, now), 'just now');
  });

  it('labels minutes, hours and days', () => {
    assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5 min ago');
    assert.equal(formatRelativeTime(now - 60 * 60_000, now), '1 hour ago');
    assert.equal(formatRelativeTime(now - 3 * 60 * 60_000, now), '3 hours ago');
    assert.equal(formatRelativeTime(now - 24 * 60 * 60_000, now), 'yesterday');
    assert.equal(formatRelativeTime(now - 5 * 24 * 60 * 60_000, now), '5 days ago');
  });
});
