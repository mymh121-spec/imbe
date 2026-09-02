import { describe, expect, it } from 'vitest';
import { measureHandLandmarks, type HandLandmarkLike } from '../modules/handDetection';

function makeHand(): HandLandmarkLike[] {
  return Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
}

describe('markerless hand pose', () => {
  it('maps the palm center and wrist-to-knuckle direction to a baton pose', () => {
    const landmarks = makeHand();
    landmarks[0] = { x: 0.5, y: 0.7, z: 0 };
    landmarks[5] = { x: 0.4, y: 0.5, z: -0.04 };
    landmarks[9] = { x: 0.5, y: 0.45, z: -0.06 };
    landmarks[13] = { x: 0.55, y: 0.5, z: -0.04 };
    landmarks[17] = { x: 0.6, y: 0.5, z: -0.03 };

    const measurement = measureHandLandmarks(landmarks, 1234, 0.9);

    expect(measurement).not.toBeNull();
    expect(measurement?.pose.timestamp).toBe(1234);
    expect(measurement?.pose.confidence).toBe(0.9);
    expect(measurement?.direction.x).toBeCloseTo(0);
    expect(measurement?.direction.y).toBeCloseTo(-1);
    expect(measurement?.pose.rotation.z).toBeCloseTo(0);
    expect(measurement?.pose.position.z).toBeGreaterThan(0.5);
  });

  it('rejects incomplete landmark sets', () => {
    expect(measureHandLandmarks(makeHand().slice(0, 10))).toBeNull();
  });
});
