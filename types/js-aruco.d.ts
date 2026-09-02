declare module 'js-aruco' {
  export type ArucoCorner = { x: number; y: number };
  export type ArucoMarker = { id: number; corners: ArucoCorner[] };
  export const AR: {
    Detector: new () => { detect(image: ImageData): ArucoMarker[] };
  };
}
