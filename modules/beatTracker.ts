import type { BatonPose } from './types';

export type BeatEvent = {
  index: number;
  beatsPerBar: number;
  bpm: number | null;
  confidence: number;
  timestamp: number;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export class BeatTracker {
  private previousPose: BatonPose | null = null;
  private smoothedVelocityY = 0;
  private apexY = 0;
  private strokeStartY = 0;
  private troughY = 0;
  private strokeStartedAt = 0;
  private downwardArmed = false;
  private lastBeatAt = -Infinity;
  private intervals: number[] = [];
  private beatIndex = 0;
  private beatsPerBar = 4;

  setBeatsPerBar(value: number) {
    this.beatsPerBar = Math.min(4, Math.max(2, Math.round(value)));
    this.beatIndex = 0;
  }

  update(pose: BatonPose | null): BeatEvent | null {
    if (!pose) {
      this.previousPose = null;
      this.smoothedVelocityY = 0;
      this.downwardArmed = false;
      return null;
    }

    if (!this.previousPose) {
      this.previousPose = pose;
      this.apexY = pose.position.y;
      return null;
    }

    const elapsedMs = pose.timestamp - this.previousPose.timestamp;
    const dt = Math.min(0.12, Math.max(1 / 120, elapsedMs / 1000));
    const velocityY = (pose.position.y - this.previousPose.position.y) / dt;
    this.smoothedVelocityY += (velocityY - this.smoothedVelocityY) * 0.48;
    this.previousPose = pose;

    if (!this.downwardArmed) {
      this.apexY = Math.max(pose.position.y, this.apexY - dt * 0.35);
      if (this.smoothedVelocityY < -0.32) {
        this.downwardArmed = true;
        this.strokeStartY = this.apexY;
        this.troughY = pose.position.y;
        this.strokeStartedAt = pose.timestamp;
      }
      return null;
    }

    this.troughY = Math.min(this.troughY, pose.position.y);
    const amplitude = this.strokeStartY - this.troughY;
    const timedOut = pose.timestamp - this.strokeStartedAt > 1_200;
    if (timedOut) {
      this.downwardArmed = false;
      this.apexY = pose.position.y;
      return null;
    }

    if (this.smoothedVelocityY <= 0.12) return null;
    this.downwardArmed = false;
    this.apexY = pose.position.y;
    if (amplitude < 0.08 || pose.timestamp - this.lastBeatAt < 250) return null;

    const interval = pose.timestamp - this.lastBeatAt;
    if (Number.isFinite(this.lastBeatAt) && interval <= 1_500) {
      this.intervals.push(interval);
      if (this.intervals.length > 8) this.intervals.shift();
    } else if (interval > 1_500) {
      this.intervals = [];
      this.beatIndex = 0;
    }
    this.lastBeatAt = pose.timestamp;
    this.beatIndex = this.beatIndex % this.beatsPerBar + 1;
    const bpm = this.intervals.length >= 2
      ? Math.round(Math.min(180, Math.max(40, 60_000 / median(this.intervals))))
      : null;

    return {
      index: this.beatIndex,
      beatsPerBar: this.beatsPerBar,
      bpm,
      confidence: Math.min(1, Math.max(0.35, amplitude / 0.28)),
      timestamp: pose.timestamp,
    };
  }

  reset() {
    this.previousPose = null;
    this.smoothedVelocityY = 0;
    this.downwardArmed = false;
    this.lastBeatAt = -Infinity;
    this.intervals = [];
    this.beatIndex = 0;
  }
}
