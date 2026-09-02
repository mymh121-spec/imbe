import { Euler, Quaternion } from 'three';
import type { BatonFrame, BatonPose } from './types';

const distance = (a: BatonPose['position'], b: BatonPose['position']) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const defaultPose = (timestamp: number): BatonPose => ({
  position: { x: 0, y: 0, z: 0.5 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  rotation: { x: 0, y: 0, z: 0 },
  timestamp,
  confidence: 0,
});

export class BatonController {
  private frame: BatonFrame;
  private lastUpdate = 0;
  private lastSeen = -Infinity;
  private lastStop = -Infinity;
  private smoothingHz = 5;
  private holdMs = 450;

  constructor() {
    this.frame = { ...defaultPose(0), speed: 0, suddenStop: false, tracking: 'idle' };
  }

  setSmoothing(value: number) {
    this.smoothingHz = Math.max(0.5, value);
  }

  update(measurement: BatonPose | null, now = performance.now()): BatonFrame {
    const dt = this.lastUpdate ? Math.min(0.1, Math.max(1 / 240, (now - this.lastUpdate) / 1000)) : 1 / 60;
    this.lastUpdate = now;
    let tracking: BatonFrame['tracking'] = 'active';

    if (measurement) {
      this.lastSeen = now;
      const alpha = 1 - Math.exp(-2 * Math.PI * this.smoothingHz * dt);
      const previousPosition = { ...this.frame.position };
      this.frame.position = {
        x: this.frame.position.x + (measurement.position.x - this.frame.position.x) * alpha,
        y: this.frame.position.y + (measurement.position.y - this.frame.position.y) * alpha,
        z: this.frame.position.z + (measurement.position.z - this.frame.position.z) * alpha,
      };
      const currentQuaternion = new Quaternion(
        this.frame.quaternion.x,
        this.frame.quaternion.y,
        this.frame.quaternion.z,
        this.frame.quaternion.w,
      );
      currentQuaternion.slerp(
        new Quaternion(
          measurement.quaternion.x,
          measurement.quaternion.y,
          measurement.quaternion.z,
          measurement.quaternion.w,
        ),
        alpha,
      );
      const rotation = new Euler().setFromQuaternion(currentQuaternion, 'XYZ');
      const instantaneousSpeed = distance(previousPosition, this.frame.position) / dt;
      const previousSpeed = this.frame.speed;
      this.frame.speed += (instantaneousSpeed - this.frame.speed) * Math.min(1, alpha * 1.4);
      const suddenStop = previousSpeed > 0.85 && this.frame.speed < 0.18 && now - this.lastStop > 700;
      if (suddenStop) this.lastStop = now;
      this.frame = {
        ...this.frame,
        quaternion: { x: currentQuaternion.x, y: currentQuaternion.y, z: currentQuaternion.z, w: currentQuaternion.w },
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
        timestamp: now,
        confidence: measurement.confidence,
        speed: this.frame.speed,
        suddenStop,
        tracking,
      };
    } else {
      tracking = now - this.lastSeen <= this.holdMs ? 'holding' : 'idle';
      this.frame.speed *= tracking === 'holding' ? 0.9 : 0.72;
      this.frame = {
        ...this.frame,
        timestamp: now,
        confidence: tracking === 'holding' ? this.frame.confidence * 0.96 : 0,
        speed: this.frame.speed,
        suddenStop: false,
        tracking,
      };
    }
    return structuredClone(this.frame);
  }

  reset(pose = defaultPose(performance.now())) {
    this.frame = { ...pose, speed: 0, suddenStop: false, tracking: 'active' };
    this.lastSeen = pose.timestamp;
    this.lastUpdate = pose.timestamp;
  }
}
