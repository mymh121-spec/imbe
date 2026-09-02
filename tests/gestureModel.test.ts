import { describe, expect, it } from 'vitest';
import * as tf from '@tensorflow/tfjs';
import {
  GESTURE_FEATURE_SIZE,
  GESTURE_SEQUENCE_LENGTH,
  GestureSequenceBuffer,
  LearnedCommandGate,
  encodeGestureModelFrame,
} from '../modules/gestureModelFeatures';
import { createGestureCommandTcn, validateGestureSequence } from '../modules/gestureModel';
import type { HandLandmarkPoint } from '../modules/gestureFeatures';

function makeHand(): HandLandmarkPoint[] {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[0] = { x: 0.5, y: 0.7, z: 0 };
  landmarks[5] = { x: 0.38, y: 0.5, z: -0.03 };
  landmarks[9] = { x: 0.5, y: 0.43, z: -0.05 };
  landmarks[13] = { x: 0.56, y: 0.5, z: -0.04 };
  landmarks[17] = { x: 0.62, y: 0.5, z: -0.02 };
  return landmarks;
}

describe('gesture model features', () => {
  it('encodes normalized landmarks and relative hand position', () => {
    const right = encodeGestureModelFrame(makeHand(), 'Right');
    const left = encodeGestureModelFrame(makeHand(), 'Left');

    expect(right).toHaveLength(GESTURE_FEATURE_SIZE);
    expect(right?.every(Number.isFinite)).toBe(true);
    expect(right?.[15]).toBeCloseTo(-left![15]);
    expect(right?.slice(-3)).toEqual(left?.slice(-3));
    expect(right?.at(-1)).toBeGreaterThan(0);
  });

  it('rejects incomplete or degenerate hands', () => {
    expect(encodeGestureModelFrame(makeHand().slice(0, 10), 'Right')).toBeNull();
    const collapsed = makeHand().map(() => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(encodeGestureModelFrame(collapsed, 'Right')).toBeNull();
  });
});

describe('gesture sequences', () => {
  it('becomes ready only after a complete fixed-length window', () => {
    const buffer = new GestureSequenceBuffer();
    const frame = Array(GESTURE_FEATURE_SIZE).fill(0.25);
    for (let index = 0; index < GESTURE_SEQUENCE_LENGTH - 1; index += 1) buffer.push(frame);
    expect(buffer.snapshot()).toBeNull();
    expect(buffer.push(frame)).toBe(true);
    expect(buffer.snapshot()).toHaveLength(GESTURE_SEQUENCE_LENGTH);
    expect(validateGestureSequence(buffer.snapshot()!)).toBe(true);
    expect(buffer.push(frame.slice(1))).toBe(false);
  });

  it('rejects malformed training samples', () => {
    const valid = Array.from(
      { length: GESTURE_SEQUENCE_LENGTH },
      () => Array(GESTURE_FEATURE_SIZE).fill(0),
    );
    expect(validateGestureSequence(valid)).toBe(true);
    valid[0][0] = Number.NaN;
    expect(validateGestureSequence(valid)).toBe(false);
  });
});

describe('learned command safety gate', () => {
  it('requires confidence, hold time, release and cooldown', () => {
    const gate = new LearnedCommandGate(0.9, 200, 800);
    const mute = { label: 'mute' as const, confidence: 0.95 };
    const unmute = { label: 'unmute' as const, confidence: 0.96 };

    expect(gate.update(mute, 0)).toBeNull();
    expect(gate.update(mute, 150)).toBeNull();
    expect(gate.update(mute, 220)).toBe('mute');
    expect(gate.update(mute, 500)).toBeNull();
    expect(gate.update({ label: 'unknown', confidence: 0.99 }, 550)).toBeNull();
    expect(gate.update(unmute, 600)).toBeNull();
    expect(gate.update(unmute, 820)).toBeNull();
    expect(gate.update({ label: 'unknown', confidence: 0.99 }, 900)).toBeNull();
    expect(gate.update(unmute, 1100)).toBeNull();
    expect(gate.update(unmute, 1320)).toBe('unmute');
  });
});

describe('gesture command TCN', () => {
  it('produces nine command probabilities with a compact model', () => {
    const model = createGestureCommandTcn(tf);
    const input = tf.zeros([1, GESTURE_SEQUENCE_LENGTH, GESTURE_FEATURE_SIZE]);
    const output = model.predict(input);
    const tensor = (Array.isArray(output) ? output[0] : output) as tf.Tensor;

    expect(tensor.shape).toEqual([1, 9]);
    expect(model.countParams()).toBeLessThan(100_000);
    const total = tensor.sum();
    expect(total.dataSync()[0]).toBeCloseTo(1, 5);

    total.dispose();
    tensor.dispose();
    input.dispose();
    model.dispose();
  });
});
