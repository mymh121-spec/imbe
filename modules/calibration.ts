import type { BatonPose, BoardMarker, BoardPose } from './types';

export type CalibrationSettings = {
  markerSizeMm: number;
  horizontalFovDeg: number;
  xRangeMm: number;
  yRangeMm: number;
  depthRangeMm: number;
  markers: BoardMarker[];
  neutralTranslationMm: { x: number; y: number; z: number };
};

const STORAGE_KEY = 'gesture-conductor-calibration-v1';

export const DEFAULT_CALIBRATION: CalibrationSettings = {
  markerSizeMm: 28,
  horizontalFovDeg: 60,
  xRangeMm: 140,
  yRangeMm: 110,
  depthRangeMm: 260,
  markers: [
    { id: 0, xMm: -34, yMm: -18, rotationDeg: 0 },
    { id: 1, xMm: 34, yMm: -18, rotationDeg: 0 },
    { id: 2, xMm: 0, yMm: 26, rotationDeg: 0 },
  ],
  neutralTranslationMm: { x: 0, y: 0, z: 380 },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export class CalibrationManager {
  private settings: CalibrationSettings;

  constructor() {
    this.settings = this.load();
  }

  getSettings(): CalibrationSettings {
    return structuredClone(this.settings);
  }

  update(next: CalibrationSettings) {
    this.settings = structuredClone(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    }
  }

  setNeutral(pose: BoardPose) {
    this.update({ ...this.settings, neutralTranslationMm: { ...pose.translationMm } });
  }

  getIntrinsics(width: number, height: number) {
    const fov = (this.settings.horizontalFovDeg * Math.PI) / 180;
    const focal = width / (2 * Math.tan(fov / 2));
    return { fx: focal, fy: focal, cx: width / 2, cy: height / 2 };
  }

  normalize(pose: BoardPose): BatonPose {
    const neutral = this.settings.neutralTranslationMm;
    return {
      position: {
        x: clamp((pose.translationMm.x - neutral.x) / this.settings.xRangeMm, -1, 1),
        y: clamp((pose.translationMm.y - neutral.y) / this.settings.yRangeMm, -1, 1),
        z: clamp(0.5 - (pose.translationMm.z - neutral.z) / this.settings.depthRangeMm, 0, 1),
      },
      quaternion: pose.quaternion,
      rotation: pose.rotation,
      timestamp: pose.timestamp,
      confidence: pose.confidence,
    };
  }

  private load(): CalibrationSettings {
    if (typeof localStorage === 'undefined') return structuredClone(DEFAULT_CALIBRATION);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return structuredClone(DEFAULT_CALIBRATION);
      const parsed = JSON.parse(saved) as CalibrationSettings;
      if (!Array.isArray(parsed.markers) || parsed.markers.length < 1) throw new Error('Invalid markers');
      return { ...structuredClone(DEFAULT_CALIBRATION), ...parsed };
    } catch {
      return structuredClone(DEFAULT_CALIBRATION);
    }
  }
}

const ROW_PATTERNS = [
  [1, 0, 0, 0, 0],
  [1, 0, 1, 1, 1],
  [0, 1, 0, 0, 1],
  [0, 1, 1, 1, 0],
];

export function markerMatrix(id: number): number[][] {
  const safeId = clamp(Math.round(id), 0, 1023);
  const matrix = Array.from({ length: 7 }, () => Array(7).fill(0));
  for (let row = 0; row < 5; row += 1) {
    const first = (safeId >> (9 - row * 2)) & 1;
    const second = (safeId >> (8 - row * 2)) & 1;
    matrix[row + 1].splice(1, 5, ...ROW_PATTERNS[(first << 1) | second]);
  }
  return matrix;
}

export function markerSvg(id: number): string {
  const matrix = markerMatrix(id);
  const cells = matrix.flatMap((row, y) =>
    row.map((value, x) => value ? `<rect x="${x + 1}" y="${y + 1}" width="1" height="1"/>` : '').filter(Boolean),
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges"><rect width="9" height="9" fill="white"/><rect x="1" y="1" width="7" height="7" fill="black"/><g fill="white">${cells}</g></svg>`;
}

export function printMarkerSheet(settings: CalibrationSettings) {
  const sheetSizeMm = settings.markerSizeMm * 9 / 7;
  const markers = settings.markers.map((marker) => `
    <figure><div class="marker">${markerSvg(marker.id)}</div><figcaption>ID ${marker.id} · ${settings.markerSizeMm} mm</figcaption></figure>
  `).join('');
  const html = `<!doctype html><html lang="ko"><head><title>ArUco Marker Sheet</title><style>
    @page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;color:#111}h1{font-size:18px;margin:0 0 18px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:22mm 18mm}figure{margin:0;text-align:center}.marker{width:${sheetSizeMm}mm;height:${sheetSizeMm}mm;margin:auto}svg{display:block;width:100%;height:100%}figcaption{margin-top:5mm;font-size:11px}.note{margin-top:18mm;font-size:11px;color:#555}@media print{button{display:none}}</style></head><body><h1>Gesture Conductor · ArUco markers</h1><div class="grid">${markers}</div><p class="note">인쇄 배율을 100%로 설정하고, 각 마커의 검은 사각형 외곽 크기를 확인하세요.</p><button onclick="window.print()">인쇄</button></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const popup = window.open(url, '_blank');
  if (!popup) {
    URL.revokeObjectURL(url);
    return false;
  }
  popup.opener = null;
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
