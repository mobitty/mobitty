import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decayVelocity, composeFlickVelocity } from './scroll-momentum.ts';

describe('decayVelocity', () => {
  it('applies one-frame decay exactly at frameMs', () => {
    assert.equal(decayVelocity(1, 16.67, 0.95, 16.67), 0.95);
  });

  it('compounds over two frames', () => {
    const v = decayVelocity(1, 33.34, 0.95, 16.67);
    assert.ok(Math.abs(v - 0.95 * 0.95) < 1e-9, `expected ≈0.9025, got ${v}`);
  });

  it('returns unchanged velocity for non-positive dt', () => {
    assert.equal(decayVelocity(2.5, 0, 0.95, 16.67), 2.5);
    assert.equal(decayVelocity(2.5, -5, 0.95, 16.67), 2.5);
  });

  it('preserves sign for negative velocity', () => {
    const v = decayVelocity(-2, 16.67, 0.95, 16.67);
    assert.ok(v < 0 && Math.abs(v + 1.9) < 1e-9);
  });

  it('is frame-rate independent — half-frame twice equals full-frame once', () => {
    const half = decayVelocity(1, 8.335, 0.95, 16.67);
    const halfAgain = decayVelocity(half, 8.335, 0.95, 16.67);
    const full = decayVelocity(1, 16.67, 0.95, 16.67);
    assert.ok(Math.abs(halfAgain - full) < 1e-9);
  });
});

describe('composeFlickVelocity', () => {
  const MIN = 0.6;

  it('returns 0 when release is below minFlick (tap / slow release)', () => {
    assert.equal(composeFlickVelocity(2.0, 0, MIN), 0);
    assert.equal(composeFlickVelocity(2.0, 0.5, MIN), 0);
    assert.equal(composeFlickVelocity(2.0, -0.5, MIN), 0);
  });

  it('passes through release when residual is 0', () => {
    assert.equal(composeFlickVelocity(0, 1.5, MIN), 1.5);
    assert.equal(composeFlickVelocity(0, -1.5, MIN), -1.5);
  });

  it('stacks when release and residual share sign (carried momentum)', () => {
    assert.equal(composeFlickVelocity(2.0, 1.5, MIN), 3.5);
    assert.equal(composeFlickVelocity(-2.0, -1.5, MIN), -3.5);
  });

  it('overrides residual when release is opposite direction', () => {
    assert.equal(composeFlickVelocity(2.0, -1.5, MIN), -1.5);
    assert.equal(composeFlickVelocity(-2.0, 1.5, MIN), 1.5);
  });

  it('does not stack when release is exactly at threshold (still a flick)', () => {
    assert.equal(composeFlickVelocity(1.0, 0.6, MIN), 1.6);
  });
});
