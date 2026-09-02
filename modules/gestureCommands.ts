import type { StaticHandGesture } from './gestureFeatures';
import type { Vec3 } from './types';

export type ConductorCommand =
  | 'mute'
  | 'unmute'
  | 'tempo-up'
  | 'tempo-down'
  | 'crescendo'
  | 'decrescendo'
  | 'balance-left'
  | 'balance-right';

export type GestureObservation = {
  gesture: StaticHandGesture;
  confidence: number;
  position: Vec3;
  timestamp: number;
};

const STATIC_COMMANDS: Partial<Record<StaticHandGesture, ConductorCommand>> = {
  fist: 'mute',
  'open-palm': 'unmute',
  'thumb-up': 'tempo-up',
  'thumb-down': 'tempo-down',
};

export class GestureCommandDetector {
  private activeGesture: StaticHandGesture = 'unknown';
  private startedAt = 0;
  private origin: Vec3 | null = null;
  private fired = false;
  private lastCommandAt = -Infinity;

  constructor(
    private readonly holdMs = 420,
    private readonly cooldownMs = 750,
    private readonly minConfidence = 0.5,
  ) {}

  update(observation: GestureObservation | null): ConductorCommand | null {
    if (!observation || observation.confidence < this.minConfidence || observation.gesture === 'unknown') {
      this.resetHold();
      return null;
    }

    if (observation.gesture !== this.activeGesture) {
      this.activeGesture = observation.gesture;
      this.startedAt = observation.timestamp;
      this.origin = { ...observation.position };
      this.fired = false;
      return null;
    }

    if (this.fired) return null;
    if (observation.gesture === 'pinch') return this.detectPinchSwipe(observation);
    if (observation.timestamp - this.startedAt < this.holdMs) return null;

    const command = STATIC_COMMANDS[observation.gesture] ?? null;
    if (!command) return null;
    return this.emit(command, observation.timestamp);
  }

  reset() {
    this.resetHold();
    this.lastCommandAt = -Infinity;
  }

  private detectPinchSwipe(observation: GestureObservation) {
    if (!this.origin || observation.timestamp - this.startedAt < 120) return null;
    const deltaX = observation.position.x - this.origin.x;
    const deltaY = observation.position.y - this.origin.y;
    const vertical = Math.abs(deltaY) >= Math.abs(deltaX) * 0.9;
    let command: ConductorCommand | null = null;

    if (vertical && deltaY > 0.24) command = 'crescendo';
    else if (vertical && deltaY < -0.24) command = 'decrescendo';
    else if (!vertical && deltaX < -0.28) command = 'balance-left';
    else if (!vertical && deltaX > 0.28) command = 'balance-right';

    return command ? this.emit(command, observation.timestamp) : null;
  }

  private emit(command: ConductorCommand, timestamp: number) {
    this.fired = true;
    if (timestamp - this.lastCommandAt < this.cooldownMs) return null;
    this.lastCommandAt = timestamp;
    return command;
  }

  private resetHold() {
    this.activeGesture = 'unknown';
    this.startedAt = 0;
    this.origin = null;
    this.fired = false;
  }
}
