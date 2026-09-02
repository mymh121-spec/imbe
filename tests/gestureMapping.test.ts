import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPPING, mapGesture } from '../modules/gestureMapping';
import type { BatonFrame } from '../modules/types';

const frame: BatonFrame = {
  position: { x: 1, y: 0.8, z: 1 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  rotation: { x: 0, y: 0, z: 0.2 },
  timestamp: 100,
  confidence: 1,
  speed: 0.6,
  suddenStop: false,
  tracking: 'active',
};

describe('mapGesture', () => {
  it('maps right, high, and near motion to pan, EQ, and master gain', () => {
    const mapped = mapGesture(frame, DEFAULT_MAPPING);
    expect(mapped.pan).toBe(1);
    expect(mapped.masterGain).toBeCloseTo(DEFAULT_MAPPING.depthMaxGain);
    expect(mapped.highEq).toBeGreaterThan(0);
    expect(mapped.lowEq).toBeLessThan(0);
    expect(mapped.intensity).toBeGreaterThan(1);
  });

  it('reduces gain to a safe level after tracking becomes idle', () => {
    const active = mapGesture(frame, DEFAULT_MAPPING);
    const idle = mapGesture({ ...frame, tracking: 'idle' }, DEFAULT_MAPPING);
    expect(idle.masterGain).toBeLessThan(active.masterGain * 0.2);
  });
});
