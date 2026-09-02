import { AR } from 'js-aruco';
import type { DetectedMarker } from './types';

export type DetectionFrame = {
  markers: DetectedMarker[];
  width: number;
  height: number;
  durationMs: number;
};

export type CameraBatonOverlay = {
  anchor: { x: number; y: number };
  direction: { x: number; y: number };
  markerSize: number;
};

export function computeCameraBatonOverlay(markers: DetectedMarker[]): CameraBatonOverlay | null {
  if (!markers.length) return null;

  const measurements = markers.map((marker) => {
    const center = marker.corners.reduce(
      (sum, corner) => ({ x: sum.x + corner.x / 4, y: sum.y + corner.y / 4 }),
      { x: 0, y: 0 },
    );
    const top = {
      x: (marker.corners[0].x + marker.corners[1].x) / 2,
      y: (marker.corners[0].y + marker.corners[1].y) / 2,
    };
    const bottom = {
      x: (marker.corners[2].x + marker.corners[3].x) / 2,
      y: (marker.corners[2].y + marker.corners[3].y) / 2,
    };
    const rawDirection = { x: top.x - bottom.x, y: top.y - bottom.y };
    const length = Math.hypot(rawDirection.x, rawDirection.y) || 1;
    const edgeLengths = marker.corners.map((corner, index) => {
      const next = marker.corners[(index + 1) % marker.corners.length];
      return Math.hypot(next.x - corner.x, next.y - corner.y);
    });
    return {
      center,
      direction: { x: rawDirection.x / length, y: rawDirection.y / length },
      size: edgeLengths.reduce((sum, edge) => sum + edge, 0) / edgeLengths.length,
    };
  });

  const anchor = measurements.reduce(
    (sum, measurement) => ({
      x: sum.x + measurement.center.x / measurements.length,
      y: sum.y + measurement.center.y / measurements.length,
    }),
    { x: 0, y: 0 },
  );
  const directionSum = measurements.reduce(
    (sum, measurement) => ({
      x: sum.x + measurement.direction.x,
      y: sum.y + measurement.direction.y,
    }),
    { x: 0, y: 0 },
  );
  const directionLength = Math.hypot(directionSum.x, directionSum.y);
  const direction = directionLength > 0.1
    ? { x: directionSum.x / directionLength, y: directionSum.y / directionLength }
    : measurements[0].direction;

  return {
    anchor,
    direction,
    markerSize: measurements.reduce((sum, measurement) => sum + measurement.size, 0) / measurements.length,
  };
}

export class MarkerDetection {
  private readonly detector = new AR.Detector();
  private readonly canvas = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d', { willReadFrequently: true });
  private readonly maxWidth = 640;
  private readonly batonTrail: Array<{ x: number; y: number }> = [];

  detect(video: HTMLVideoElement, preview?: HTMLCanvasElement): DetectionFrame | null {
    if (!this.context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return null;
    const scale = Math.min(1, this.maxWidth / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const startedAt = performance.now();
    this.context.drawImage(video, 0, 0, width, height);
    const image = this.context.getImageData(0, 0, width, height);
    const markers = this.detector.detect(image).map((marker) => ({
      id: marker.id,
      corners: marker.corners.slice(0, 4).map((corner) => ({ x: corner.x, y: corner.y })) as DetectedMarker['corners'],
    }));
    if (preview) this.drawPreview(preview, image, markers);
    return { markers, width, height, durationMs: performance.now() - startedAt };
  }

  private drawPreview(canvas: HTMLCanvasElement, image: ImageData, markers: DetectedMarker[]) {
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.putImageData(image, 0, 0);
    context.lineWidth = 3;
    context.font = '600 14px monospace';
    for (const marker of markers) {
      context.strokeStyle = '#6cc9ff';
      context.fillStyle = '#0d1318';
      context.beginPath();
      marker.corners.forEach((corner, index) => {
        if (index === 0) context.moveTo(corner.x, corner.y);
        else context.lineTo(corner.x, corner.y);
      });
      context.closePath();
      context.stroke();
      const origin = marker.corners[0];
      context.fillStyle = '#e7563b';
      context.beginPath();
      context.arc(origin.x, origin.y, 5, 0, Math.PI * 2);
      context.fill();
      const center = marker.corners.reduce((sum, corner) => ({ x: sum.x + corner.x / 4, y: sum.y + corner.y / 4 }), { x: 0, y: 0 });
      context.fillStyle = '#0d1318cc';
      context.fillRect(center.x - 18, center.y - 12, 36, 22);
      context.fillStyle = '#ffffff';
      context.fillText(String(marker.id), center.x - 10, center.y + 5);
    }
    this.drawCameraBaton(context, canvas, markers);
  }

  private drawCameraBaton(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, markers: DetectedMarker[]) {
    const overlay = computeCameraBatonOverlay(markers);
    if (!overlay) {
      this.batonTrail.splice(0, Math.min(2, this.batonTrail.length));
      this.drawBatonTrail(context);
      return;
    }

    const shortestSide = Math.min(canvas.width, canvas.height);
    const bladeLength = Math.min(
      shortestSide * 0.58,
      Math.max(shortestSide * 0.22, overlay.markerSize * 4.2),
    );
    const tip = {
      x: overlay.anchor.x + overlay.direction.x * bladeLength,
      y: overlay.anchor.y + overlay.direction.y * bladeLength,
    };
    this.batonTrail.push(tip);
    if (this.batonTrail.length > 18) this.batonTrail.shift();
    this.drawBatonTrail(context);

    const perpendicular = { x: -overlay.direction.y, y: overlay.direction.x };
    const handleLength = Math.max(18, overlay.markerSize * 0.7);
    const guardWidth = Math.max(18, overlay.markerSize * 0.55);
    const handleEnd = {
      x: overlay.anchor.x - overlay.direction.x * handleLength,
      y: overlay.anchor.y - overlay.direction.y * handleLength,
    };

    context.save();
    context.lineCap = 'round';
    context.shadowColor = '#43c8ff';
    context.shadowBlur = 18;
    context.strokeStyle = '#43c8ff66';
    context.lineWidth = 16;
    context.beginPath();
    context.moveTo(overlay.anchor.x, overlay.anchor.y);
    context.lineTo(tip.x, tip.y);
    context.stroke();

    context.shadowBlur = 10;
    context.strokeStyle = '#75dcff';
    context.lineWidth = 7;
    context.stroke();
    context.shadowBlur = 4;
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2.5;
    context.stroke();

    context.shadowBlur = 0;
    context.strokeStyle = '#111820';
    context.lineWidth = 12;
    context.beginPath();
    context.moveTo(overlay.anchor.x, overlay.anchor.y);
    context.lineTo(handleEnd.x, handleEnd.y);
    context.stroke();
    context.strokeStyle = '#e7563b';
    context.lineWidth = 5;
    context.stroke();

    context.strokeStyle = '#edf4f7';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(
      overlay.anchor.x - perpendicular.x * guardWidth / 2,
      overlay.anchor.y - perpendicular.y * guardWidth / 2,
    );
    context.lineTo(
      overlay.anchor.x + perpendicular.x * guardWidth / 2,
      overlay.anchor.y + perpendicular.y * guardWidth / 2,
    );
    context.stroke();
    context.restore();
  }

  private drawBatonTrail(context: CanvasRenderingContext2D) {
    if (this.batonTrail.length < 2) return;
    context.save();
    context.lineCap = 'round';
    for (let index = 1; index < this.batonTrail.length; index += 1) {
      const progress = index / this.batonTrail.length;
      context.strokeStyle = `rgba(108, 201, 255, ${progress * 0.5})`;
      context.lineWidth = 1 + progress * 3;
      context.beginPath();
      context.moveTo(this.batonTrail[index - 1].x, this.batonTrail[index - 1].y);
      context.lineTo(this.batonTrail[index].x, this.batonTrail[index].y);
      context.stroke();
    }
    context.restore();
  }
}
