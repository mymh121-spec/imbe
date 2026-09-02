import * as THREE from 'three';
import type { BatonFrame } from './types';

const TRAIL_LENGTH = 80;

export class BatonVisualizer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly baton = new THREE.Group();
  private readonly targetPosition = new THREE.Vector3(0, 0, 0);
  private readonly targetQuaternion = new THREE.Quaternion();
  private readonly alignQuaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  );
  private readonly trailGeometry = new THREE.BufferGeometry();
  private readonly trailPositions = new Float32Array(TRAIL_LENGTH * 3);
  private readonly trail: THREE.Line;
  private readonly resizeObserver: ResizeObserver;
  private trailPoints: THREE.Vector3[] = [];
  private lastTrailAt = 0;
  private animationFrame = 0;

  constructor(private readonly mount: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mount.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 1.4, 8.7);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xcfe7ff, 0x17202a, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.6);
    keyLight.position.set(2, 5, 5);
    this.scene.add(keyLight);
    const rimLight = new THREE.PointLight(0xe7563b, 8, 9);
    rimLight.position.set(-3, -2, 3);
    this.scene.add(rimLight);

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.082, 3.7, 18),
      new THREE.MeshStandardMaterial({ color: 0xe9f1f8, metalness: 0.62, roughness: 0.22 }),
    );
    shaft.position.y = 0.3;
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 0.9, 20),
      new THREE.MeshStandardMaterial({ color: 0xe7563b, metalness: 0.18, roughness: 0.4 }),
    );
    handle.position.y = -1.95;
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.095, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x6cc9ff, emissiveIntensity: 1.8 }),
    );
    tip.position.y = 2.18;
    this.baton.add(shaft, handle, tip);
    this.scene.add(this.baton);

    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(
      this.trailGeometry,
      new THREE.LineBasicMaterial({ color: 0x6cc9ff, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(this.trail);

    const grid = new THREE.GridHelper(10, 20, 0x2d495e, 0x1c2a34);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -2.2;
    this.scene.add(grid);
    [1.2, 2.2, 3.2].forEach((radius) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.008, 6, 80),
        new THREE.MeshBasicMaterial({ color: 0x27414f, transparent: true, opacity: 0.5 }),
      );
      ring.position.z = -2.15;
      this.scene.add(ring);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    this.resize();
    this.animate();
  }

  update(frame: BatonFrame) {
    this.targetPosition.set(frame.position.x * 3.1, frame.position.y * 2.15, (frame.position.z - 0.5) * 2.2);
    const poseQuaternion = new THREE.Quaternion(
      frame.quaternion.x,
      frame.quaternion.y,
      frame.quaternion.z,
      frame.quaternion.w,
    );
    this.targetQuaternion.copy(poseQuaternion).multiply(this.alignQuaternion);
    const now = performance.now();
    const last = this.trailPoints.at(-1);
    if (!last || last.distanceTo(this.targetPosition) > 0.045 || now - this.lastTrailAt > 75) {
      this.trailPoints.push(this.targetPosition.clone());
      if (this.trailPoints.length > TRAIL_LENGTH) this.trailPoints.shift();
      this.lastTrailAt = now;
      this.updateTrail();
    }
  }

  private updateTrail() {
    this.trailPoints.forEach((point, index) => {
      const offset = index * 3;
      this.trailPositions[offset] = point.x;
      this.trailPositions[offset + 1] = point.y;
      this.trailPositions[offset + 2] = point.z;
    });
    this.trailGeometry.setDrawRange(0, this.trailPoints.length);
    this.trailGeometry.attributes.position.needsUpdate = true;
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.mount;
    this.camera.aspect = Math.max(width, 1) / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = () => {
    this.baton.position.lerp(this.targetPosition, 0.22);
    this.baton.quaternion.slerp(this.targetQuaternion, 0.2);
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  dispose() {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
