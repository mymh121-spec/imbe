import { describe, expect, it } from 'vitest';
import { GestureCommandDetector, type GestureObservation } from '../modules/gestureCommands';
import type { StaticHandGesture } from '../modules/gestureFeatures';

const observation = (
  gesture: StaticHandGesture,
  timestamp: number,
  x = 0,
  y = 0,
): GestureObservation => ({
  gesture,
  confidence: 0.9,
  position: { x, y, z: 0.5 },
  timestamp,
});

describe('GestureCommandDetector', () => {
  it('requires a stable hold and fires a static command only once', () => {
    const detector = new GestureCommandDetector(100, 200, 0.6);
    expect(detector.update(observation('fist', 0))).toBeNull();
    expect(detector.update(observation('fist', 80))).toBeNull();
    expect(detector.update(observation('fist', 120))).toBe('mute');
    expect(detector.update(observation('fist', 400))).toBeNull();

    detector.update(observation('unknown', 410));
    expect(detector.update(observation('open-palm', 450))).toBeNull();
    expect(detector.update(observation('open-palm', 560))).toBe('unmute');
  });

  it('maps deliberate pinched swipes to dynamics and balance commands', () => {
    const detector = new GestureCommandDetector(100, 100, 0.6);
    detector.update(observation('pinch', 0, 0, 0));
    expect(detector.update(observation('pinch', 150, 0.03, 0.3))).toBe('crescendo');
    detector.update(observation('unknown', 200));
    detector.update(observation('pinch', 300, 0, 0));
    expect(detector.update(observation('pinch', 450, -0.34, 0.02))).toBe('balance-left');
  });

  it('ignores low-confidence observations', () => {
    const detector = new GestureCommandDetector(100, 100, 0.7);
    const lowConfidence = { ...observation('fist', 0), confidence: 0.5 };
    expect(detector.update(lowConfidence)).toBeNull();
    expect(detector.update({ ...lowConfidence, timestamp: 500 })).toBeNull();
  });
});
