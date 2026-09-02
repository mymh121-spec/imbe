export type Vec3 = { x: number; y: number; z: number };
export type QuaternionValue = { x: number; y: number; z: number; w: number };

export type MarkerCorner = { x: number; y: number };

export type DetectedMarker = {
  id: number;
  corners: [MarkerCorner, MarkerCorner, MarkerCorner, MarkerCorner];
};

export type BoardMarker = {
  id: number;
  xMm: number;
  yMm: number;
  rotationDeg: number;
};

export type BoardPose = {
  translationMm: Vec3;
  quaternion: QuaternionValue;
  rotation: Vec3;
  normal: Vec3;
  markerCount: number;
  confidence: number;
  reprojectionErrorPx: number;
  timestamp: number;
};

export type BatonPose = {
  position: Vec3;
  quaternion: QuaternionValue;
  rotation: Vec3;
  timestamp: number;
  confidence: number;
};

export type BatonFrame = BatonPose & {
  speed: number;
  suddenStop: boolean;
  tracking: 'active' | 'holding' | 'idle';
};

export type MappingOutput = {
  masterGain: number;
  pan: number;
  lowEq: number;
  midEq: number;
  highEq: number;
  intensity: number;
  suddenStop: boolean;
};
