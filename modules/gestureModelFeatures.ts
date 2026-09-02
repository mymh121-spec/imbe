import type { ConductorCommand } from './gestureCommands';
import type { HandLandmarkPoint } from './gestureFeatures';

export const GESTURE_SEQUENCE_LENGTH = 24;
export const GESTURE_FEATURE_SIZE = 66;
export const GESTURE_MODEL_LABELS = [
  'unknown',
  'mute',
  'unmute',
  'tempo-up',
  'tempo-down',
  'crescendo',
  'decrescendo',
  'balance-left',
  'balance-right',
] as const;

export type GestureModelLabel = (typeof GESTURE_MODEL_LABELS)[number];

export type GestureModelPrediction = {
  label: GestureModelLabel;
  confidence: number;
};

const PALM_INDICES = [0, 5, 9, 13, 17];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function encodeGestureModelFrame(
  landmarks: HandLandmarkPoint[],
  handedness: string | null,
): number[] | null {
  if (landmarks.length < 21) return null;
  const wrist = landmarks[0];
  const indexKnuckle = landmarks[5];
  const pinkyKnuckle = landmarks[17];
  const palmSpan = Math.hypot(
    indexKnuckle.x - pinkyKnuckle.x,
    indexKnuckle.y - pinkyKnuckle.y,
    indexKnuckle.z - pinkyKnuckle.z,
  );
  if (palmSpan < 0.015) return null;

  const mirror = handedness === 'Left' ? -1 : 1;
  const features = landmarks.slice(0, 21).flatMap((landmark) => [
    clamp(((landmark.x - wrist.x) / palmSpan) * mirror, -3, 3) / 3,
    clamp((landmark.y - wrist.y) / palmSpan, -3, 3) / 3,
    clamp((landmark.z - wrist.z) / palmSpan, -3, 3) / 3,
  ]);
  const anchor = PALM_INDICES.reduce(
    (sum, index) => ({
      x: sum.x + landmarks[index].x / PALM_INDICES.length,
      y: sum.y + landmarks[index].y / PALM_INDICES.length,
    }),
    { x: 0, y: 0 },
  );
  features.push(
    clamp((anchor.x - 0.5) * 2, -1, 1),
    clamp((0.5 - anchor.y) * 2, -1, 1),
    clamp((palmSpan - 0.07) / 0.22, 0, 1),
  );
  return features;
}

export class GestureSequenceBuffer {
  private readonly frames: number[][] = [];

  push(frame: number[]) {
    if (frame.length !== GESTURE_FEATURE_SIZE) return false;
    this.frames.push([...frame]);
    if (this.frames.length > GESTURE_SEQUENCE_LENGTH) this.frames.shift();
    return true;
  }

  snapshot(): number[][] | null {
    return this.frames.length === GESTURE_SEQUENCE_LENGTH
      ? this.frames.map((frame) => [...frame])
      : null;
  }

  get progress() {
    return this.frames.length / GESTURE_SEQUENCE_LENGTH;
  }

  reset() {
    this.frames.length = 0;
  }
}

export class LearnedCommandGate {
  private candidate: GestureModelLabel = 'unknown';
  private startedAt = 0;
  private fired = false;
  private lastCommandAt = -Infinity;

  constructor(
    private readonly minConfidence = 0.9,
    private readonly holdMs = 220,
    private readonly cooldownMs = 850,
  ) {}

  update(prediction: GestureModelPrediction | null, timestamp: number): ConductorCommand | null {
    if (!prediction || prediction.label === 'unknown' || prediction.confidence < this.minConfidence) {
      this.release();
      return null;
    }
    if (prediction.label !== this.candidate) {
      this.candidate = prediction.label;
      this.startedAt = timestamp;
      this.fired = false;
      return null;
    }
    if (this.fired || timestamp - this.startedAt < this.holdMs) return null;

    this.fired = true;
    if (timestamp - this.lastCommandAt < this.cooldownMs) return null;
    this.lastCommandAt = timestamp;
    return prediction.label;
  }

  release() {
    this.candidate = 'unknown';
    this.startedAt = 0;
    this.fired = false;
  }

  reset() {
    this.release();
    this.lastCommandAt = -Infinity;
  }
}
