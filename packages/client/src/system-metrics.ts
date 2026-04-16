// Collects and exposes system performance metrics: RTT, FPS, data transfer.
// Plain TypeScript — no React dependency.
// See workspace/docs/design-system-metrics.md for architecture.

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

const BUCKET_MS = 10_000; // 10 seconds per bucket
const NUM_BUCKETS = 60; // 60 buckets = 10-minute window
const BUCKETS_1M = 6;
const BUCKETS_5M = 30;
const BUCKETS_10M = 60;

interface Bucket {
  epoch: number;
  sum: number;
  count: number;
}

function makeBuckets(): Bucket[] {
  return Array.from({ length: NUM_BUCKETS }, () => ({ epoch: -1, sum: 0, count: 0 }));
}

class BucketedTimeSeries {
  private readonly buckets = makeBuckets();

  record(value: number): void {
    const epoch = Math.floor(Date.now() / BUCKET_MS);
    const idx = epoch % NUM_BUCKETS;
    const b = this.buckets[idx]!;
    if (b.epoch === epoch) {
      b.sum += value;
      b.count++;
    } else {
      b.epoch = epoch;
      b.sum = value;
      b.count = 1;
    }
  }

  sum(windowBuckets: number): number {
    const currentEpoch = Math.floor(Date.now() / BUCKET_MS);
    let total = 0;
    for (let i = 0; i < windowBuckets; i++) {
      const e = currentEpoch - i;
      const b = this.buckets[e % NUM_BUCKETS]!;
      if (b.epoch === e) total += b.sum;
    }
    return total;
  }

  avg(windowBuckets: number): number {
    const currentEpoch = Math.floor(Date.now() / BUCKET_MS);
    let totalSum = 0;
    let totalCount = 0;
    for (let i = 0; i < windowBuckets; i++) {
      const e = currentEpoch - i;
      const b = this.buckets[e % NUM_BUCKETS]!;
      if (b.epoch === e) {
        totalSum += b.sum;
        totalCount += b.count;
      }
    }
    return totalCount > 0 ? Math.round(totalSum / totalCount) : 0;
  }
}

export class SystemMetrics {
  private readonly rtt = new BucketedTimeSeries();
  private readonly bytesIn = new BucketedTimeSeries();
  private readonly bytesOut = new BucketedTimeSeries();
  private targetFps = 0;

  recordRtt(ms: number): void {
    this.rtt.record(ms);
  }

  recordBytesIn(n: number): void {
    this.bytesIn.record(n);
  }

  recordBytesOut(n: number): void {
    this.bytesOut.record(n);
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
  }

  getSnapshot(): SystemMetricsSnapshot {
    return {
      rtt: {
        min1: this.rtt.avg(BUCKETS_1M),
        min5: this.rtt.avg(BUCKETS_5M),
        min10: this.rtt.avg(BUCKETS_10M),
      },
      fps: this.targetFps,
      dataIn: {
        min1: this.bytesIn.sum(BUCKETS_1M),
        min5: this.bytesIn.sum(BUCKETS_5M),
        min10: this.bytesIn.sum(BUCKETS_10M),
      },
      dataOut: {
        min1: this.bytesOut.sum(BUCKETS_1M),
        min5: this.bytesOut.sum(BUCKETS_5M),
        min10: this.bytesOut.sum(BUCKETS_10M),
      },
    };
  }
}
