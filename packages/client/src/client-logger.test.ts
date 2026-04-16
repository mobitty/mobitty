import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// DOM + sessionStorage shim — installed before importing ClientLogger
// ---------------------------------------------------------------------------

type VisibilityListener = () => void;

let hidden = false;
const visibilityListeners: VisibilityListener[] = [];

const g = globalThis as Record<string, unknown>;

if (!g['document']) {
  g['document'] = {};
}
const doc = g['document'] as Record<string, unknown>;

// Proxy `document.hidden` so tests can toggle it dynamically
Object.defineProperty(doc, 'hidden', { get: () => hidden, configurable: true });

doc['addEventListener'] = (type: string, fn: VisibilityListener) => {
  if (type === 'visibilitychange') visibilityListeners.push(fn);
};
doc['removeEventListener'] = (type: string, fn: VisibilityListener) => {
  if (type === 'visibilitychange') {
    const i = visibilityListeners.indexOf(fn);
    if (i >= 0) visibilityListeners.splice(i, 1);
  }
};

// Minimal sessionStorage shim
const storage = new Map<string, string>();
if (!g['sessionStorage']) {
  g['sessionStorage'] = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  };
}

// Dynamic import after shims
const { ClientLogger } = await import('./client-logger.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fireVisibilityChange() {
  for (const fn of [...visibilityListeners]) fn();
}

function setHidden(value: boolean) {
  hidden = value;
  fireVisibilityChange();
}

/** Decode a CLIENT_LOG payload back to the JSON batch array. */
function decodeBatch(payload: Uint8Array): unknown[] {
  assert.equal(payload[0], 0x39, 'first byte should be CMD_CLIENT_LOG');
  const json = new TextDecoder().decode(payload.subarray(1));
  return JSON.parse(json) as unknown[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClientLogger', () => {
  let logger: InstanceType<typeof ClientLogger>;
  let sent: Uint8Array[];

  beforeEach(() => {
    hidden = false;
    sent = [];
    storage.clear();
    // Suppress console output from the logger
    // (logs still go to console.log/warn/error inside log())
    logger = new ClientLogger({
      sendToServer: (p: Uint8Array) => sent.push(p),
      flushIntervalMs: 50, // fast for tests
    });
  });

  afterEach(() => {
    logger.dispose();
  });

  describe('default flush interval', () => {
    it('uses 5000ms when flushIntervalMs is not provided', () => {
      const l2 = new ClientLogger({ sendToServer: () => {} });
      // Access private field via index signature
      const rec = l2 as unknown as Record<string, unknown>;
      assert.equal(rec['flushIntervalMs'], 5000);
      l2.dispose();
    });
  });

  describe('flush suppression when hidden', () => {
    it('does not flush while tab is hidden', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });

      logger.setConnected(true);
      setHidden(true);
      logger.info('background message');

      // Advance well past the flush interval
      t.mock.timers.tick(200);
      assert.equal(sent.length, 0, 'should not send while hidden');
    });

    it('accumulates logs in buffer while hidden', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });

      logger.setConnected(true);
      setHidden(true);

      logger.info('msg1');
      logger.info('msg2');
      logger.info('msg3');

      t.mock.timers.tick(200);
      assert.equal(sent.length, 0, 'nothing sent while hidden');

      // Become visible — should flush all accumulated logs
      setHidden(false);
      assert.equal(sent.length, 1, 'flushed on visible');

      const batch = decodeBatch(sent[0]);
      assert.equal(batch.length, 3, 'all three messages in one batch');
    });

    it('cancels pending flush timer when tab becomes hidden', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });

      logger.setConnected(true);
      logger.info('before hide');

      // Timer is scheduled but hasn't fired yet
      assert.equal(sent.length, 0);

      // Hide the tab — should cancel the pending timer
      setHidden(true);

      // Advance past when the timer would have fired
      t.mock.timers.tick(200);
      assert.equal(sent.length, 0, 'cancelled timer did not fire');

      // Become visible — flush
      setHidden(false);
      assert.equal(sent.length, 1);
    });

    it('does not flush on visible when buffer is empty', () => {
      logger.setConnected(true);
      setHidden(true);

      // No logs added while hidden
      setHidden(false);
      assert.equal(sent.length, 0, 'no flush for empty buffer');
    });

    it('does not flush on visible when disconnected', () => {
      logger.setConnected(true);
      setHidden(true);
      logger.info('buffered');
      logger.setConnected(false);

      setHidden(false);
      assert.equal(sent.length, 0, 'no flush when disconnected');
    });
  });

  describe('dispose', () => {
    it('removes the visibilitychange listener', () => {
      const countBefore = visibilityListeners.length;
      logger.dispose();
      assert.equal(visibilityListeners.length, countBefore - 1);
    });

    it('is safe to call twice', () => {
      logger.dispose();
      logger.dispose(); // should not throw
    });
  });

  describe('normal flush (tab visible)', () => {
    it('flushes after the interval when connected and visible', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });

      logger.setConnected(true);
      logger.info('hello');

      assert.equal(sent.length, 0, 'not yet flushed');
      t.mock.timers.tick(50);
      assert.equal(sent.length, 1, 'flushed after interval');

      const batch = decodeBatch(sent[0]);
      assert.equal(batch.length, 1);
    });
  });
});
