import { describe, expect, it } from 'vitest';
import { BatonController } from '../modules/batonController';
import type { BatonPose } from '../modules/types';

const pose = (x: number, timestamp: number): BatonPose => ({
  position: { x, y: 0, z: 0.5 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  rotation: { x: 0, y: 0, z: 0 },
  timestamp,
  confidence: 1,
});

describe('BatonController', () => {
  it('holds the last pose briefly before entering the safe idle state', () => {
    const controller = new BatonController();
    controller.reset(pose(0.4, 1_000));

    const holding = controller.update(null, 1_400);
    const idle = controller.update(null, 1_451);

    expect(holding.tracking).toBe('holding');
    expect(holding.position.x).toBeCloseTo(0.4);
    expect(idle.tracking).toBe('idle');
    expect(idle.confidence).toBe(0);
  });

  it('uses the configured low-pass rate when interpolating a new pose', () => {
    const slow = new BatonController();
    const fast = new BatonController();
    slow.reset(pose(0, 1_000));
    fast.reset(pose(0, 1_000));
    slow.setSmoothing(0.5);
    fast.setSmoothing(12);

    const slowFrame = slow.update(pose(1, 1_016), 1_016);
    const fastFrame = fast.update(pose(1, 1_016), 1_016);

    expect(slowFrame.tracking).toBe('active');
    expect(slowFrame.position.x).toBeGreaterThan(0);
    expect(fastFrame.position.x).toBeGreaterThan(slowFrame.position.x);
    expect(fastFrame.position.x).toBeLessThan(1);
  });
});
