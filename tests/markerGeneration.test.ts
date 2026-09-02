import { describe, expect, it } from 'vitest';
import { AR } from 'js-aruco';
import { markerMatrix, markerSvg } from '../modules/calibration';

describe('ArUco marker generation', () => {
  it('creates a 7x7 marker with a solid black border', () => {
    const matrix = markerMatrix(42);
    expect(matrix).toHaveLength(7);
    expect(matrix.every((row) => row.length === 7)).toBe(true);
    expect(matrix[0].every((cell) => cell === 0)).toBe(true);
    expect(matrix[6].every((cell) => cell === 0)).toBe(true);
    expect(matrix.every((row) => row[0] === 0 && row[6] === 0)).toBe(true);
  });

  it('encodes the requested ID and emits a printable SVG', () => {
    const matrix = markerMatrix(42);
    let decoded = 0;
    for (let row = 1; row <= 5; row += 1) {
      decoded = (decoded << 1) | matrix[row][2];
      decoded = (decoded << 1) | matrix[row][4];
    }
    expect(decoded).toBe(42);
    expect(markerSvg(42)).toContain('viewBox="0 0 9 9"');
  });

  it('is detected by the bundled ArUco detector with the same ID', () => {
    const id = 42;
    const width = 224;
    const cell = 24;
    const origin = 28;
    const data = new Uint8ClampedArray(width * width * 4);
    for (let pixel = 0; pixel < width * width; pixel += 1) {
      data[pixel * 4] = 255;
      data[pixel * 4 + 1] = 255;
      data[pixel * 4 + 2] = 255;
      data[pixel * 4 + 3] = 255;
    }
    const matrix = markerMatrix(id);
    matrix.forEach((row, y) => row.forEach((value, x) => {
      if (value) return;
      for (let localY = 0; localY < cell; localY += 1) {
        for (let localX = 0; localX < cell; localX += 1) {
          const pixelX = origin + x * cell + localX;
          const pixelY = origin + y * cell + localY;
          const offset = (pixelY * width + pixelX) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
        }
      }
    }));
    const detections = new AR.Detector().detect({ width, height: width, data } as ImageData);
    expect(detections.map((marker) => marker.id)).toContain(id);
  });
});
