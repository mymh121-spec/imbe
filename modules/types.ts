export type Vec3 = { x: number; y: number; z: number };
export type QuaternionValue = { x: number; y: number; z: number; w: number };

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
