import { describe, expect, it } from 'vitest';
import { estimateBoardPose, type CameraIntrinsics } from '../modules/poseEstimation';
import type { BoardMarker, DetectedMarker } from '../modules/types';

const intrinsics: CameraIntrinsics = { fx: 620, fy: 620, cx: 320, cy: 240 };
const markerSize = 28;

function detectionFor(marker: BoardMarker, translation: { x: number; y: number; z: number }): DetectedMarker {
  const half = markerSize / 2;
  const objectCorners = [
    { x: marker.xMm - half, y: marker.yMm + half },
    { x: marker.xMm + half, y: marker.yMm + half },
    { x: marker.xMm + half, y: marker.yMm - half },
    { x: marker.xMm - half, y: marker.yMm - half },
  ];
  return {
    id: marker.id,
    corners: objectCorners.map((point) => ({
      x: intrinsics.cx + intrinsics.fx * (point.x + translation.x) / translation.z,
      y: intrinsics.cy - intrinsics.fy * (point.y + translation.y) / translation.z,
    })) as DetectedMarker['corners'],
  };
}

describe('estimateBoardPose', () => {
  it('recovers a front-facing board translation from one visible marker', () => {
    const board = [{ id: 7, xMm: 0, yMm: 0, rotationDeg: 0 }];
    const translation = { x: 24, y: -16, z: 410 };
    const pose = estimateBoardPose([detectionFor(board[0], translation)], board, markerSize, intrinsics, 1000);
    expect(pose).not.toBeNull();
    expect(pose!.translationMm.x).toBeCloseTo(translation.x, 3);
    expect(pose!.translationMm.y).toBeCloseTo(translation.y, 3);
    expect(pose!.translationMm.z).toBeCloseTo(translation.z, 2);
    expect(pose!.markerCount).toBe(1);
    expect(pose!.reprojectionErrorPx).toBeLessThan(0.01);
  });

  it('uses the remaining configured markers when part of the board is hidden', () => {
    const board = [
      { id: 0, xMm: -34, yMm: -18, rotationDeg: 0 },
      { id: 1, xMm: 34, yMm: -18, rotationDeg: 0 },
      { id: 2, xMm: 0, yMm: 26, rotationDeg: 0 },
    ];
    const translation = { x: -18, y: 10, z: 360 };
    const pose = estimateBoardPose(
      [detectionFor(board[0], translation), detectionFor(board[2], translation)],
      board,
      markerSize,
      intrinsics,
      1200,
    );
    expect(pose).not.toBeNull();
    expect(pose!.markerCount).toBe(2);
    expect(pose!.translationMm.z).toBeCloseTo(translation.z, 2);
    expect(pose!.confidence).toBeGreaterThan(0.7);
  });
});
