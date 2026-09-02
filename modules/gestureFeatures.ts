export type HandLandmarkPoint = { x: number; y: number; z: number };

export type StaticHandGesture =
  | 'fist'
  | 'open-palm'
  | 'thumb-up'
  | 'thumb-down'
  | 'pinch'
  | 'unknown';

export type GestureFeatures = {
  gesture: StaticHandGesture;
  confidence: number;
  extendedFingers: number;
  pinchRatio: number;
  openness: number;
};

const FINGER_JOINTS = [
  { mcp: 5, pip: 6, tip: 8 },
  { mcp: 9, pip: 10, tip: 12 },
  { mcp: 13, pip: 14, tip: 16 },
  { mcp: 17, pip: 18, tip: 20 },
];
const PALM_INDICES = [0, 5, 9, 13, 17];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (a: HandLandmarkPoint, b: HandLandmarkPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function extractGestureFeatures(landmarks: HandLandmarkPoint[]): GestureFeatures {
  if (landmarks.length < 21) {
    return { gesture: 'unknown', confidence: 0, extendedFingers: 0, pinchRatio: 1, openness: 0 };
  }

  const palmCenter = PALM_INDICES.reduce(
    (sum, index) => ({
      x: sum.x + landmarks[index].x / PALM_INDICES.length,
      y: sum.y + landmarks[index].y / PALM_INDICES.length,
      z: sum.z + landmarks[index].z / PALM_INDICES.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const palmSpan = distance(landmarks[5], landmarks[17]);
  if (palmSpan < 0.015) {
    return { gesture: 'unknown', confidence: 0, extendedFingers: 0, pinchRatio: 1, openness: 0 };
  }

  const extended = FINGER_JOINTS.map(({ mcp, pip, tip }) => {
    const palmTip = distance(palmCenter, landmarks[tip]);
    const palmPip = distance(palmCenter, landmarks[pip]);
    const segmentReach = distance(landmarks[mcp], landmarks[tip]);
    const bentReach = distance(landmarks[mcp], landmarks[pip]);
    return palmTip > palmPip * 1.12 && segmentReach > bentReach * 1.35;
  });
  const extendedFingers = extended.filter(Boolean).length;
  const thumbTipDistance = distance(palmCenter, landmarks[4]);
  const thumbJointDistance = distance(palmCenter, landmarks[3]);
  const thumbExtended = thumbTipDistance > thumbJointDistance * 1.12;
  const pinchRatio = distance(landmarks[4], landmarks[8]) / palmSpan;
  const openness = FINGER_JOINTS.reduce(
    (sum, { tip }) => sum + distance(palmCenter, landmarks[tip]) / palmSpan,
    0,
  ) / FINGER_JOINTS.length;

  if (pinchRatio < 0.34) {
    return {
      gesture: 'pinch',
      confidence: clamp(1 - pinchRatio / 0.45, 0.55, 1),
      extendedFingers,
      pinchRatio,
      openness,
    };
  }

  const thumbVector = {
    x: landmarks[4].x - landmarks[2].x,
    y: landmarks[4].y - landmarks[2].y,
  };
  const normalizedThumbVertical = Math.abs(thumbVector.y) / palmSpan;
  if (
    thumbExtended &&
    extendedFingers <= 1 &&
    normalizedThumbVertical > 0.55 &&
    Math.abs(thumbVector.y) > Math.abs(thumbVector.x) * 1.15
  ) {
    return {
      gesture: thumbVector.y < 0 ? 'thumb-up' : 'thumb-down',
      confidence: clamp(0.62 + normalizedThumbVertical * 0.24, 0.62, 0.96),
      extendedFingers,
      pinchRatio,
      openness,
    };
  }

  if (extendedFingers >= 4 && thumbExtended && openness > 1.45) {
    return {
      gesture: 'open-palm',
      confidence: clamp(0.62 + (openness - 1.4) * 0.3, 0.62, 0.96),
      extendedFingers,
      pinchRatio,
      openness,
    };
  }

  if (extendedFingers === 0 && openness < 1.18) {
    return {
      gesture: 'fist',
      confidence: clamp(0.68 + (1.18 - openness) * 0.35, 0.68, 0.96),
      extendedFingers,
      pinchRatio,
      openness,
    };
  }

  return {
    gesture: 'unknown',
    confidence: 0.4,
    extendedFingers,
    pinchRatio,
    openness,
  };
}
