import type { HandLandmarker, HandLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { Euler, Quaternion } from 'three';
import { CameraBatonRenderer } from './cameraBatonOverlay';
import type { BatonPose } from './types';

export type HandDetectorState = 'idle' | 'loading' | 'ready' | 'error';

export type HandDetectionFrame = {
  pose: BatonPose | null;
  handCount: number;
  handedness: string | null;
  durationMs: number;
};

export type HandLandmarkLike = Pick<NormalizedLandmark, 'x' | 'y' | 'z'>;

export type HandMeasurement = {
  pose: BatonPose;
  anchor: { x: number; y: number };
  direction: { x: number; y: number };
  palmSpan: number;
};

type HandConnection = { start: number; end: number };

const PALM_INDICES = [0, 5, 9, 13, 17];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function measureHandLandmarks(
  landmarks: HandLandmarkLike[],
  timestamp = performance.now(),
  confidence = 0.8,
): HandMeasurement | null {
  if (landmarks.length < 21) return null;

  const anchor = PALM_INDICES.reduce(
    (sum, index) => ({
      x: sum.x + landmarks[index].x / PALM_INDICES.length,
      y: sum.y + landmarks[index].y / PALM_INDICES.length,
    }),
    { x: 0, y: 0 },
  );
  const wrist = landmarks[0];
  const middleKnuckle = landmarks[9];
  const rawDirection = {
    x: middleKnuckle.x - wrist.x,
    y: middleKnuckle.y - wrist.y,
  };
  const directionLength = Math.hypot(rawDirection.x, rawDirection.y) || 1;
  const direction = {
    x: rawDirection.x / directionLength,
    y: rawDirection.y / directionLength,
  };
  const indexKnuckle = landmarks[5];
  const pinkyKnuckle = landmarks[17];
  const palmSpan = Math.hypot(indexKnuckle.x - pinkyKnuckle.x, indexKnuckle.y - pinkyKnuckle.y);
  const pitch = clamp((wrist.z - middleKnuckle.z) * 5, -0.9, 0.9);
  const roll = Math.atan2(direction.x, -direction.y);
  const quaternion = new Quaternion().setFromEuler(new Euler(pitch, 0, roll, 'XYZ')).normalize();

  return {
    pose: {
      position: {
        x: clamp((anchor.x - 0.5) * 2.2, -1, 1),
        y: clamp((0.5 - anchor.y) * 2.2, -1, 1),
        z: clamp((palmSpan - 0.07) / 0.22, 0, 1),
      },
      rotation: { x: pitch, y: 0, z: roll },
      quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      timestamp,
      confidence: clamp(confidence, 0, 1),
    },
    anchor,
    direction,
    palmSpan,
  };
}

export class HandDetection {
  private landmarker: HandLandmarker | null = null;
  private connections: HandConnection[] = [];
  private initializePromise: Promise<void> | null = null;
  private lastVideoTime = -1;
  private lastTimestamp = -1;
  private readonly batonRenderer = new CameraBatonRenderer();
  state: HandDetectorState = 'idle';
  errorMessage = '';

  initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise;
    this.state = 'loading';
    this.initializePromise = this.loadModel();
    return this.initializePromise;
  }

  detect(video: HTMLVideoElement, preview: HTMLCanvasElement | undefined, timestamp = performance.now()): HandDetectionFrame | null {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;

    const startedAt = performance.now();
    let result: HandLandmarkerResult | null = null;
    if (this.landmarker) {
      const monotonicTimestamp = Math.max(timestamp, this.lastTimestamp + 1);
      this.lastTimestamp = monotonicTimestamp;
      result = this.landmarker.detectForVideo(video, monotonicTimestamp);
    }

    const landmarks = result?.landmarks[0] ?? null;
    const confidence = result?.handedness[0]?.[0]?.score ?? 0;
    const measurement = landmarks ? measureHandLandmarks(landmarks, timestamp, confidence) : null;
    if (preview) this.drawPreview(video, preview, landmarks, measurement);
    return {
      pose: measurement?.pose ?? null,
      handCount: result?.landmarks.length ?? 0,
      handedness: result?.handedness[0]?.[0]?.categoryName ?? null,
      durationMs: performance.now() - startedAt,
    };
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    this.initializePromise = null;
    this.state = 'idle';
    this.batonRenderer.reset();
  }

  private async loadModel() {
    try {
      const { FilesetResolver, HandLandmarker: HandLandmarkerClass } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm', false);
      this.landmarker = await HandLandmarkerClass.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: '/mediapipe/models/hand_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });
      this.connections = HandLandmarkerClass.HAND_CONNECTIONS;
      this.state = 'ready';
    } catch (error) {
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : 'Hand tracking initialization failed';
      this.initializePromise = null;
      throw error;
    }
  }

  private drawPreview(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    landmarks: NormalizedLandmark[] | null,
    measurement: HandMeasurement | null,
  ) {
    const scale = Math.min(1, 640 / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      this.batonRenderer.reset();
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);

    if (landmarks) {
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = '#62d39ccc';
      context.lineWidth = 2;
      for (const connection of this.connections) {
        const start = landmarks[connection.start];
        const end = landmarks[connection.end];
        if (!start || !end) continue;
        context.beginPath();
        context.moveTo(start.x * width, start.y * height);
        context.lineTo(end.x * width, end.y * height);
        context.stroke();
      }
      landmarks.forEach((landmark, index) => {
        context.fillStyle = index === 0 ? '#e7563b' : '#eaf8f1';
        context.beginPath();
        context.arc(landmark.x * width, landmark.y * height, index === 0 ? 5 : 3, 0, Math.PI * 2);
        context.fill();
      });
      context.restore();
    }

    if (!measurement) {
      this.batonRenderer.draw(context, canvas, null);
      return;
    }
    const pixelDirection = {
      x: measurement.direction.x * width,
      y: measurement.direction.y * height,
    };
    const pixelDirectionLength = Math.hypot(pixelDirection.x, pixelDirection.y) || 1;
    const indexKnuckle = landmarks![5];
    const pinkyKnuckle = landmarks![17];
    const gripScale = Math.hypot(
      (indexKnuckle.x - pinkyKnuckle.x) * width,
      (indexKnuckle.y - pinkyKnuckle.y) * height,
    );
    this.batonRenderer.draw(context, canvas, {
      anchor: { x: measurement.anchor.x * width, y: measurement.anchor.y * height },
      direction: { x: pixelDirection.x / pixelDirectionLength, y: pixelDirection.y / pixelDirectionLength },
      gripScale,
    });
  }
}
