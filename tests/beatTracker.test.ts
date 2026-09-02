import { describe, expect, it } from 'vitest';
import { BeatTracker } from '../modules/beatTracker';
import type { BatonPose } from '../modules/types';

const pose = (y: number, timestamp: number): BatonPose => ({
  position: { x: 0, y, z: 0.5 },
  rotation: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  confidence: 1,
  timestamp,
});

describe('BeatTracker', () => {
  it('counts downward strokes and estimates BPM from recent intervals', () => {
    const tracker = new BeatTracker();
    const events = [];
    for (let beat = 0; beat < 5; beat += 1) {
      const start = 1_000 + beat * 600;
      for (const [offset, y] of [[0, 0.45], [100, 0.24], [200, 0], [300, 0.25], [400, 0.45]] as const) {
        const event = tracker.update(pose(y, start + offset));
        if (event) events.push(event);
      }
    }

    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.at(-1)?.bpm).toBe(100);
    expect(events.slice(0, 4).map((event) => event.index)).toEqual([1, 2, 3, 4]);
  });

  it('supports a three-beat bar and ignores small jitter', () => {
    const tracker = new BeatTracker();
    tracker.setBeatsPerBar(3);
    const events = [];
    for (let beat = 0; beat < 4; beat += 1) {
      const start = 1_000 + beat * 500;
      for (const [offset, y] of [[0, 0.4], [100, 0.18], [200, -0.05], [300, 0.2], [400, 0.4]] as const) {
        const event = tracker.update(pose(y, start + offset));
        if (event) events.push(event);
      }
    }
    expect(events.slice(0, 4).map((event) => event.index)).toEqual([1, 2, 3, 1]);

    const jitter = new BeatTracker();
    const jitterEvents = [0, 0.02, -0.01, 0.025, 0].map((y, index) => jitter.update(pose(y, 3_000 + index * 100)));
    expect(jitterEvents.every((event) => event === null)).toBe(true);
  });
});
