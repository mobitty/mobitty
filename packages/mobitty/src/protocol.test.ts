import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoInterval } from './protocol.ts';
import { isUpdateSettingsMessage } from './types.ts';

describe('isUpdateSettingsMessage — imagePasteDir', () => {
  it('accepts relative directory', () => {
    assert.equal(isUpdateSettingsMessage({ imagePasteDir: 'images' }), true);
  });

  it('accepts nested relative directory', () => {
    assert.equal(isUpdateSettingsMessage({ imagePasteDir: 'sub/images' }), true);
  });

  it('rejects absolute path', () => {
    assert.equal(isUpdateSettingsMessage({ imagePasteDir: '/tmp/evil' }), false);
  });

  it('allows traversal (caught at use-time containment check)', () => {
    assert.equal(isUpdateSettingsMessage({ imagePasteDir: '../../etc' }), true);
  });
});

describe('computeAutoInterval', () => {
  it('stays at 30fps with oscillating RTT (audit scenario)', () => {
    // Simulates the RTT pattern from the protocol audit:
    // 13 → 109 → 9 → 44 → 9 → 78
    const rtts = [13, 109, 9, 44, 9, 78];
    let smooth = 33;
    let interval = 33; // start at 30fps
    for (const rtt of rtts) {
      const r = computeAutoInterval(rtt, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 33, 'should stay at 30fps with oscillating RTT');
  });

  it('upgrades to 60fps after consistent low RTT', () => {
    let smooth = 33;
    let interval = 33;
    // Feed several consistently low RTT samples
    for (let i = 0; i < 10; i++) {
      const r = computeAutoInterval(10, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 16, 'should upgrade to 60fps after consistent low RTT');
  });

  it('needs ~3 low-RTT samples to upgrade from 30fps', () => {
    let smooth = 33;
    let interval = 33;

    // 1st sample
    let r = computeAutoInterval(10, smooth, interval);
    smooth = r.smoothRtt; interval = r.syncIntervalMs;
    assert.equal(interval, 33, 'still 30fps after 1 sample');

    // 2nd sample
    r = computeAutoInterval(10, smooth, interval);
    smooth = r.smoothRtt; interval = r.syncIntervalMs;
    assert.equal(interval, 33, 'still 30fps after 2 samples');

    // 3rd sample
    r = computeAutoInterval(10, smooth, interval);
    smooth = r.smoothRtt; interval = r.syncIntervalMs;
    assert.equal(interval, 16, 'upgrades to 60fps after 3 samples');
  });

  it('single spike does not downgrade from 60fps', () => {
    // Start with low smoothRtt (already at 60fps)
    let smooth = 15;
    let interval = 16;

    // One high RTT spike
    const r = computeAutoInterval(120, smooth, interval);
    assert.equal(r.syncIntervalMs, 16, 'single spike should not downgrade');
  });

  it('downgrades to 30fps after sustained high RTT', () => {
    let smooth = 15;
    let interval = 16; // at 60fps

    // Feed consistently high RTT
    for (let i = 0; i < 10; i++) {
      const r = computeAutoInterval(80, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 33, 'should downgrade to 30fps after sustained high RTT');
  });

  it('stays in dead zone without changing', () => {
    // smoothRtt in dead zone [20, 50] — should keep current interval
    const r30 = computeAutoInterval(35, 35, 33);
    assert.equal(r30.syncIntervalMs, 33, 'keeps 30fps in dead zone');

    const r60 = computeAutoInterval(35, 35, 16);
    assert.equal(r60.syncIntervalMs, 16, 'keeps 60fps in dead zone');
  });

  it('handles extreme RTT spike gracefully', () => {
    // The audit saw a 1515ms spike — should not crash, should push toward downgrade
    let smooth = 20;
    let interval = 16;
    const r = computeAutoInterval(1515, smooth, interval);
    assert.ok(r.smoothRtt > 50, 'extreme spike pushes smoothRtt above downgrade threshold');
  });

  // High-RTT scaling tier (smoothRtt > 100ms → 0.5×RTT, capped at 250ms)
  it('scales interval to 0.5×RTT at 150ms', () => {
    // Feed consistent 150ms RTT until smoothRtt stabilizes above 100
    let smooth = 33;
    let interval = 33;
    for (let i = 0; i < 20; i++) {
      const r = computeAutoInterval(150, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 75, 'should scale to 75ms at 150ms RTT');
  });

  it('scales interval to 0.5×RTT at 300ms', () => {
    let smooth = 33;
    let interval = 33;
    for (let i = 0; i < 20; i++) {
      const r = computeAutoInterval(300, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 150, 'should scale to 150ms at 300ms RTT');
  });

  it('caps interval at 250ms for very high RTT', () => {
    let smooth = 33;
    let interval = 33;
    for (let i = 0; i < 20; i++) {
      const r = computeAutoInterval(600, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 250, 'should cap at 250ms (4fps floor)');
  });

  it('recovers from high RTT back to 60fps', () => {
    // Start at high RTT
    let smooth = 300;
    let interval = 150;
    // Feed consistently low RTT
    for (let i = 0; i < 20; i++) {
      const r = computeAutoInterval(10, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 16, 'should recover to 60fps after sustained low RTT');
  });

  it('transitions smoothly across 100ms boundary', () => {
    // Start at 30fps (smoothRtt ~80)
    let smooth = 80;
    let interval = 33;
    // RTT rises to 120 — should cross into scaling tier
    for (let i = 0; i < 10; i++) {
      const r = computeAutoInterval(120, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.ok(smooth > 100, 'smoothRtt should cross 100ms');
    assert.ok(interval > 33, 'interval should exceed 30fps tier');
    assert.equal(interval, Math.min(Math.round(smooth * 0.5), 250), 'interval should be 0.5×smoothRtt');
  });
});
