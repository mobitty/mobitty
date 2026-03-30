// Collects and exposes system performance metrics: RTT, FPS, data transfer.
// Plain TypeScript — no React dependency.

interface TimestampedSample {
  ts: number;
  value: number;
}

interface WindowedStats {
  min1: number;
  min5: number;
  min10: number;
}

export interface SystemMetricsSnapshot {
  rtt: WindowedStats;
  fps: number;
  dataIn: WindowedStats;
  dataOut: WindowedStats;
}

const WINDOW_1M = 60_000;
const WINDOW_5M = 300_000;
const WINDOW_10M = 600_000;
const PRUNE_INTERVAL = 30_000;

function windowedAvg(samples: TimestampedSample[], windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  let sum = 0;
  let count = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]!;
    if (s.ts < cutoff) break;
    sum += s.value;
    count++;
  }
  return count > 0 ? Math.round(sum / count) : 0;
}

function windowedSum(samples: TimestampedSample[], windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  let sum = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]!;
    if (s.ts < cutoff) break;
    sum += s.value;
  }
  return sum;
}

function pruneOld(samples: TimestampedSample[], maxAge: number, now: number): void {
  const cutoff = now - maxAge;
  let i = 0;
  while (i < samples.length && samples[i]!.ts < cutoff) i++;
  if (i > 0) samples.splice(0, i);
}

export class SystemMetrics {
  private rttSamples: TimestampedSample[] = [];
  private bytesInSamples: TimestampedSample[] = [];
  private bytesOutSamples: TimestampedSample[] = [];

  private targetFps = 0;
  private pruneTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL);
  }

  recordRtt(ms: number): void {
    this.rttSamples.push({ ts: Date.now(), value: ms });
  }

  recordBytesIn(n: number): void {
    this.bytesInSamples.push({ ts: Date.now(), value: n });
  }

  recordBytesOut(n: number): void {
    this.bytesOutSamples.push({ ts: Date.now(), value: n });
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
  }

  getSnapshot(): SystemMetricsSnapshot {
    const now = Date.now();
    return {
      rtt: {
        min1: windowedAvg(this.rttSamples, WINDOW_1M, now),
        min5: windowedAvg(this.rttSamples, WINDOW_5M, now),
        min10: windowedAvg(this.rttSamples, WINDOW_10M, now),
      },
      fps: this.targetFps,
      dataIn: {
        min1: windowedSum(this.bytesInSamples, WINDOW_1M, now),
        min5: windowedSum(this.bytesInSamples, WINDOW_5M, now),
        min10: windowedSum(this.bytesInSamples, WINDOW_10M, now),
      },
      dataOut: {
        min1: windowedSum(this.bytesOutSamples, WINDOW_1M, now),
        min5: windowedSum(this.bytesOutSamples, WINDOW_5M, now),
        min10: windowedSum(this.bytesOutSamples, WINDOW_10M, now),
      },
    };
  }

  private prune(): void {
    const now = Date.now();
    pruneOld(this.rttSamples, WINDOW_10M, now);
    pruneOld(this.bytesInSamples, WINDOW_10M, now);
    pruneOld(this.bytesOutSamples, WINDOW_10M, now);
  }

  dispose(): void {
    clearInterval(this.pruneTimer);
  }
}
