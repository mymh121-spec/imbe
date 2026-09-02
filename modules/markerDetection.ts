import { AR } from 'js-aruco';
import type { DetectedMarker } from './types';

export type DetectionFrame = {
  markers: DetectedMarker[];
  width: number;
  height: number;
  durationMs: number;
};

export class MarkerDetection {
  private readonly detector = new AR.Detector();
  private readonly canvas = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d', { willReadFrequently: true });
  private readonly maxWidth = 640;

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
  }
}
