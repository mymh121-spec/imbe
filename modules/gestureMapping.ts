import type { BatonFrame, MappingOutput } from './types';

export type MappingSettings = {
  panSensitivity: number;
  eqRangeDb: number;
  depthMinGain: number;
  depthMaxGain: number;
  tiltResponse: number;
  velocityResponse: number;
  smoothingHz: number;
  rampSeconds: number;
  suddenStopAction: 'off' | 'duck' | 'pause';
};

export const DEFAULT_MAPPING: MappingSettings = {
  panSensitivity: 1,
  eqRangeDb: 12,
  depthMinGain: 0.08,
  depthMaxGain: 0.95,
  tiltResponse: 0.65,
  velocityResponse: 0.45,
  smoothingHz: 5,
  rampSeconds: 0.08,
  suddenStopAction: 'duck',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function mapGesture(frame: BatonFrame, settings: MappingSettings): MappingOutput {
  const trackingGain = frame.tracking === 'idle' ? 0.12 : frame.tracking === 'holding' ? 0.7 : 1;
  const depthGain = settings.depthMinGain + frame.position.z * (settings.depthMaxGain - settings.depthMinGain);
  const tilt = clamp((frame.rotation.x + frame.rotation.z) / Math.PI, -1, 1);
  const vertical = clamp(frame.position.y + tilt * settings.tiltResponse, -1, 1);
  const velocityBoost = clamp(frame.speed * settings.velocityResponse, 0, 0.45);

  return {
    masterGain: clamp(depthGain * trackingGain, 0, 1),
    pan: clamp(frame.position.x * settings.panSensitivity, -1, 1),
    lowEq: clamp(-vertical * settings.eqRangeDb + velocityBoost * 2, -18, 18),
    midEq: clamp(-Math.abs(vertical) * settings.eqRangeDb * 0.35 + velocityBoost * 3, -12, 12),
    highEq: clamp(vertical * settings.eqRangeDb + velocityBoost * 2, -18, 18),
    intensity: 1 + velocityBoost,
    suddenStop: frame.suddenStop,
  };
}
