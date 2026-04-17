import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateReleaseVelocity, type VelocitySample } from './gesture-detector.ts';

function samples(points: readonly (readonly [number, number])[]): VelocitySample[] {
  return points.map(([t, y]) => ({ t, y }));
}

describe('estimateReleaseVelocity', () => {
  it('returns 0 for empty buffer', () => {
    assert.equal(estimateReleaseVelocity([], 100, 100), 0);
  });

  it('returns 0 for single sample', () => {
    assert.equal(estimateReleaseVelocity(samples([[10, 0]]), 20, 100), 0);
  });

  it('computes velocity from newest-to-oldest within window', () => {
    // y goes 0 → 100 over 50ms: velocity = 2 px/ms
    const v = estimateReleaseVelocity(samples([[0, 0], [25, 50], [50, 100]]), 50, 100);
    assert.equal(v, 2);
  });

  it('ignores samples older than the window', () => {
    // First two samples are outside the 100ms window.  Only last two count:
    // y goes 80 → 100 over 20ms: velocity = 1 px/ms
    const v = estimateReleaseVelocity(
      samples([[0, 0], [50, 40], [180, 80], [200, 100]]),
      200,
      100,
    );
    assert.equal(v, 1);
  });

  it('returns 0 when all samples are stale (only newest in window)', () => {
    // Only the last sample falls within the window — fewer than 2 valid samples
    const v = estimateReleaseVelocity(
      samples([[0, 0], [50, 40], [100, 80]]),
      300,
      100,
    );
    assert.equal(v, 0);
  });

  it('returns 0 when dt is 0 (all valid samples at same time)', () => {
    const v = estimateReleaseVelocity(samples([[100, 10], [100, 20]]), 100, 100);
    assert.equal(v, 0);
  });

  it('preserves sign for upward movement (y decreasing)', () => {
    // y goes 100 → 0 over 50ms → velocity = -2 px/ms (fingers moving up)
    const v = estimateReleaseVelocity(samples([[0, 100], [25, 50], [50, 0]]), 50, 100);
    assert.equal(v, -2);
  });

  it('uses actual time delta, not count', () => {
    // Sparse samples still produce accurate velocity
    const v = estimateReleaseVelocity(samples([[0, 0], [80, 80]]), 80, 100);
    assert.equal(v, 1);
  });
});
