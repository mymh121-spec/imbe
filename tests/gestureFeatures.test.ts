import { describe, expect, it } from 'vitest';
import { extractGestureFeatures, type HandLandmarkPoint } from '../modules/gestureFeatures';

function openHand(): HandLandmarkPoint[] {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.62, z: 0 }));
  landmarks[0] = { x: 0.5, y: 0.76, z: 0 };
  landmarks[1] = { x: 0.45, y: 0.69, z: 0 };
  landmarks[2] = { x: 0.4, y: 0.65, z: 0 };
  landmarks[3] = { x: 0.34, y: 0.61, z: 0 };
  landmarks[4] = { x: 0.27, y: 0.56, z: 0 };
  [
    [5, 0.4, 0.58], [6, 0.4, 0.45], [7, 0.4, 0.34], [8, 0.4, 0.23],
    [9, 0.48, 0.55], [10, 0.48, 0.42], [11, 0.48, 0.3], [12, 0.48, 0.18],
    [13, 0.56, 0.57], [14, 0.56, 0.44], [15, 0.56, 0.33], [16, 0.56, 0.23],
    [17, 0.64, 0.6], [18, 0.64, 0.47], [19, 0.64, 0.38], [20, 0.64, 0.3],
  ].forEach(([index, x, y]) => { landmarks[index] = { x, y, z: 0 }; });
  return landmarks;
}

function curledHand(): HandLandmarkPoint[] {
  const landmarks = openHand();
  [
    [6, 0.4, 0.55], [7, 0.4, 0.6], [8, 0.42, 0.64],
    [10, 0.48, 0.53], [11, 0.48, 0.59], [12, 0.48, 0.64],
    [14, 0.56, 0.55], [15, 0.56, 0.6], [16, 0.55, 0.65],
    [18, 0.63, 0.58], [19, 0.62, 0.62], [20, 0.6, 0.66],
  ].forEach(([index, x, y]) => { landmarks[index] = { x, y, z: 0 }; });
  landmarks[2] = { x: 0.48, y: 0.67, z: 0 };
  landmarks[3] = { x: 0.54, y: 0.68, z: 0 };
  landmarks[4] = { x: 0.6, y: 0.69, z: 0 };
  return landmarks;
}

describe('extractGestureFeatures', () => {
  it('recognizes an open palm and a fist from normalized landmark ratios', () => {
    expect(extractGestureFeatures(openHand()).gesture).toBe('open-palm');
    expect(extractGestureFeatures(curledHand()).gesture).toBe('fist');
  });

  it('recognizes thumb direction while the other fingers are curled', () => {
    const up = curledHand();
    up[2] = { x: 0.43, y: 0.66, z: 0 };
    up[3] = { x: 0.43, y: 0.51, z: 0 };
    up[4] = { x: 0.43, y: 0.34, z: 0 };
    const down = up.map((point) => ({ ...point }));
    down[3] = { x: 0.43, y: 0.79, z: 0 };
    down[4] = { x: 0.43, y: 0.94, z: 0 };

    expect(extractGestureFeatures(up).gesture).toBe('thumb-up');
    expect(extractGestureFeatures(down).gesture).toBe('thumb-down');
  });

  it('recognizes a thumb-index pinch before the open-palm rule', () => {
    const pinch = openHand();
    pinch[4] = { ...pinch[8] };
    expect(extractGestureFeatures(pinch).gesture).toBe('pinch');
  });
});
