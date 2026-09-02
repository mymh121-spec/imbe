import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { BoardMarker, BoardPose, DetectedMarker, MarkerCorner } from './types';

export type CameraIntrinsics = { fx: number; fy: number; cx: number; cy: number };

type Correspondence = {
  markerId: number;
  object: { x: number; y: number };
  image: MarkerCorner;
};

const vectorLength = (value: number[]) => Math.hypot(value[0], value[1], value[2]);
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (value: number[]) => {
  const length = vectorLength(value) || 1;
  return value.map((item) => item / length);
};
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function solveLinear(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) augmented[row][item] -= factor * augmented[column][item];
    }
  }
  return augmented.map((row) => row[size]);
}

function fitHomography(points: Correspondence[], intrinsics: CameraIntrinsics): number[] | null {
  if (points.length < 4) return null;
  const rows: number[][] = [];
  const values: number[] = [];
  for (const point of points) {
    const x = point.object.x;
    const y = point.object.y;
    const u = (point.image.x - intrinsics.cx) / intrinsics.fx;
    const v = (intrinsics.cy - point.image.y) / intrinsics.fy;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  const normal = Array.from({ length: 8 }, () => Array(8).fill(0));
  const target = Array(8).fill(0);
  rows.forEach((row, rowIndex) => {
    for (let i = 0; i < 8; i += 1) {
      target[i] += row[i] * values[rowIndex];
      for (let j = 0; j < 8; j += 1) normal[i][j] += row[i] * row[j];
    }
  });
  const solved = solveLinear(normal, target);
  return solved ? [...solved, 1] : null;
}

function project(homography: number[], point: { x: number; y: number }, intrinsics: CameraIntrinsics) {
  const denominator = homography[6] * point.x + homography[7] * point.y + homography[8];
  const normalizedX = (homography[0] * point.x + homography[1] * point.y + homography[2]) / denominator;
  const normalizedY = (homography[3] * point.x + homography[4] * point.y + homography[5]) / denominator;
  return { x: normalizedX * intrinsics.fx + intrinsics.cx, y: intrinsics.cy - normalizedY * intrinsics.fy };
}

function markerObjectCorners(marker: BoardMarker, size: number) {
  const half = size / 2;
  const radians = (marker.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    { x: -half, y: half },
    { x: half, y: half },
    { x: half, y: -half },
    { x: -half, y: -half },
  ].map((corner) => ({
    x: marker.xMm + corner.x * cosine - corner.y * sine,
    y: marker.yMm + corner.x * sine + corner.y * cosine,
  }));
}

function buildCorrespondences(detected: DetectedMarker[], board: BoardMarker[], markerSizeMm: number) {
  const boardById = new Map(board.map((marker) => [marker.id, marker]));
  return detected.flatMap((marker) => {
    const configured = boardById.get(marker.id);
    if (!configured) return [];
    const objectCorners = markerObjectCorners(configured, markerSizeMm);
    return marker.corners.map((image, index) => ({ markerId: marker.id, object: objectCorners[index], image }));
  });
}

function reprojectionError(points: Correspondence[], homography: number[], intrinsics: CameraIntrinsics) {
  if (!points.length) return Infinity;
  const squareError = points.reduce((sum, point) => {
    const projected = project(homography, point.object, intrinsics);
    return sum + (projected.x - point.image.x) ** 2 + (projected.y - point.image.y) ** 2;
  }, 0);
  return Math.sqrt(squareError / points.length);
}

export function estimateBoardPose(
  detected: DetectedMarker[],
  board: BoardMarker[],
  markerSizeMm: number,
  intrinsics: CameraIntrinsics,
  timestamp = performance.now(),
): BoardPose | null {
  let points = buildCorrespondences(detected, board, markerSizeMm);
  let homography = fitHomography(points, intrinsics);
  if (!homography) return null;

  const visibleIds = [...new Set(points.map((point) => point.markerId))];
  if (visibleIds.length > 1) {
    const errors = visibleIds.map((id) => {
      const markerPoints = points.filter((point) => point.markerId === id);
      return { id, error: reprojectionError(markerPoints, homography!, intrinsics) };
    }).sort((a, b) => a.error - b.error);
    const median = errors[Math.floor(errors.length / 2)].error;
    const worst = errors.at(-1)!;
    if (worst.error > Math.max(5, median * 2.5)) {
      const filtered = points.filter((point) => point.markerId !== worst.id);
      const refit = fitHomography(filtered, intrinsics);
      if (refit) {
        points = filtered;
        homography = refit;
      }
    }
  }

  const firstColumn = [homography[0], homography[3], homography[6]];
  const secondColumn = [homography[1], homography[4], homography[7]];
  const thirdColumn = [homography[2], homography[5], homography[8]];
  const sign = thirdColumn[2] >= 0 ? 1 : -1;
  const scale = (2 / (vectorLength(firstColumn) + vectorLength(secondColumn))) * sign;
  const r1 = normalize(firstColumn.map((value) => value * sign));
  const secondOrthogonal = secondColumn.map((value, index) => value * sign - dot(secondColumn.map((item) => item * sign), r1) * r1[index]);
  const r2 = normalize(secondOrthogonal);
  const r3 = normalize(cross(r1, r2));
  const translation = thirdColumn.map((value) => value * scale);
  if (!Number.isFinite(translation[2]) || translation[2] <= 0) return null;

  const rotationMatrix = new Matrix4().set(
    r1[0], r2[0], r3[0], 0,
    r1[1], r2[1], r3[1], 0,
    r1[2], r2[2], r3[2], 0,
    0, 0, 0, 1,
  );
  const quaternion = new Quaternion().setFromRotationMatrix(rotationMatrix).normalize();
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
  const normal = new Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();
  const error = reprojectionError(points, homography, intrinsics);
  const markerCount = new Set(points.map((point) => point.markerId)).size;
  const coverage = Math.min(1, markerCount / Math.max(1, board.length));
  const confidence = Math.max(0, Math.min(1, (0.45 + coverage * 0.55) / (1 + error / 8)));

  return {
    translationMm: { x: translation[0], y: translation[1], z: translation[2] },
    quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
    normal: { x: normal.x, y: normal.y, z: normal.z },
    markerCount,
    confidence,
    reprojectionErrorPx: error,
    timestamp,
  };
}
