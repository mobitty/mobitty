// Pure helpers for iOS-style pan-scroll momentum.  DOM-free; see
// terminal-core.ts for the RAF loop that consumes them.
//
// Physics: exponential decay — v(t+Δt) = v(t) × rate ^ (Δt / frameMs).
// Rate 0.95 per 16.67ms frame matches UIScrollView DecelerationRate.normal
// (time constant τ ≈ 325 ms).  Decay time is independent of initial velocity;
// velocity only affects distance, matching iOS feel.

export const MOMENTUM_DECAY_RATE = 0.95;
export const MOMENTUM_FRAME_MS = 16.67;
export const MOMENTUM_EPSILON = 0.02;    // px/ms — stop below this (~1.2 px/s; sub-row)
export const MIN_FLICK_VELOCITY = 0.6;   // px/ms — matches FLICK_VELOCITY in gesture-detector.ts

export function decayVelocity(v: number, dt: number, rate: number, frameMs: number): number {
  if (dt <= 0) return v;
  return v * Math.pow(rate, dt / frameMs);
}

// Compose release-flick velocity with any residual momentum, iOS-style:
//   - Slow release (below minFlick) → 0, discard residual (intentional stop).
//   - Same direction → release + residual (carried momentum, stacks).
//   - Opposite or no residual → release (override; don't fight user intent).
export function composeFlickVelocity(residual: number, release: number, minFlick: number): number {
  if (Math.abs(release) < minFlick) return 0;
  if (residual === 0) return release;
  if (Math.sign(residual) === Math.sign(release)) return release + residual;
  return release;
}
