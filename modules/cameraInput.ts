export type CameraState = 'off' | 'requesting' | 'ready' | 'denied' | 'unavailable' | 'error';

export class CameraInput {
  private stream: MediaStream | null = null;

  async start(video: HTMLVideoElement): Promise<CameraState> {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });
      video.srcObject = this.stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      return 'ready';
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'unavailable';
      return 'error';
    }
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  isActive() {
    return Boolean(this.stream?.getVideoTracks().some((track) => track.readyState === 'live'));
  }
}
