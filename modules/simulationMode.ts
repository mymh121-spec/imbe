import { Euler, Quaternion } from 'three';
import type { BatonPose } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export class SimulationMode {
  private element: HTMLElement | null = null;
  private dragging = false;
  private position = { x: 0, y: 0, z: 0.58 };
  private rotation = { x: 0.08, y: -0.18, z: -0.26 };
  private onChange: (pose: BatonPose) => void = () => undefined;

  attach(element: HTMLElement, onChange: (pose: BatonPose) => void) {
    this.detach();
    this.element = element;
    this.onChange = onChange;
    element.addEventListener('pointerdown', this.handlePointerDown);
    element.addEventListener('pointermove', this.handlePointerMove);
    element.addEventListener('pointerup', this.handlePointerUp);
    element.addEventListener('pointercancel', this.handlePointerUp);
    element.addEventListener('wheel', this.handleWheel, { passive: false });
    element.addEventListener('keydown', this.handleKeyDown);
    this.emit();
  }

  detach() {
    if (!this.element) return;
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerUp);
    this.element.removeEventListener('wheel', this.handleWheel);
    this.element.removeEventListener('keydown', this.handleKeyDown);
    this.element = null;
  }

  sample(timestamp = performance.now()): BatonPose {
    const quaternion = new Quaternion().setFromEuler(new Euler(this.rotation.x, this.rotation.y, this.rotation.z, 'XYZ'));
    return {
      position: { ...this.position },
      rotation: { ...this.rotation },
      quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      timestamp,
      confidence: 1,
    };
  }

  reset() {
    this.position = { x: 0, y: 0, z: 0.58 };
    this.rotation = { x: 0.08, y: -0.18, z: -0.26 };
    this.emit();
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.dragging = true;
    this.element?.setPointerCapture(event.pointerId);
    this.setPointerPosition(event);
    this.element?.focus();
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.setPointerPosition(event);
  };

  private handlePointerUp = (event: PointerEvent) => {
    this.dragging = false;
    if (this.element?.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
  };

  private setPointerPosition(event: PointerEvent) {
    if (!this.element) return;
    const bounds = this.element.getBoundingClientRect();
    this.position.x = clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1);
    this.position.y = clamp(1 - ((event.clientY - bounds.top) / bounds.height) * 2, -1, 1);
    this.rotation.z = -this.position.x * 0.55;
    this.rotation.x = this.position.y * 0.4;
    this.emit();
  }

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.position.z = clamp(this.position.z - event.deltaY * 0.001, 0, 1);
    this.emit();
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    const positionStep = event.shiftKey ? 0.12 : 0.045;
    const rotationStep = event.shiftKey ? 0.16 : 0.07;
    let handled = true;
    switch (event.key.toLowerCase()) {
      case 'a': this.position.x -= positionStep; break;
      case 'd': this.position.x += positionStep; break;
      case 'w': this.position.y += positionStep; break;
      case 's': this.position.y -= positionStep; break;
      case 'r': this.position.z += positionStep; break;
      case 'f': this.position.z -= positionStep; break;
      case 'arrowup': this.rotation.x += rotationStep; break;
      case 'arrowdown': this.rotation.x -= rotationStep; break;
      case 'arrowleft': this.rotation.y += rotationStep; break;
      case 'arrowright': this.rotation.y -= rotationStep; break;
      case 'q': this.rotation.z += rotationStep; break;
      case 'e': this.rotation.z -= rotationStep; break;
      case ' ': this.reset(); break;
      default: handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    this.position.x = clamp(this.position.x, -1, 1);
    this.position.y = clamp(this.position.y, -1, 1);
    this.position.z = clamp(this.position.z, 0, 1);
    this.emit();
  };

  private emit() {
    this.onChange(this.sample());
  }
}
