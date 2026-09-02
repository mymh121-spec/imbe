export type CameraBatonOverlay = {
  anchor: { x: number; y: number };
  direction: { x: number; y: number };
  gripScale: number;
};

export class CameraBatonRenderer {
  private readonly trail: Array<{ x: number; y: number }> = [];

  draw(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, overlay: CameraBatonOverlay | null) {
    if (!overlay) {
      this.trail.splice(0, Math.min(2, this.trail.length));
      this.drawTrail(context);
      return;
    }

    const shortestSide = Math.min(canvas.width, canvas.height);
    const bladeLength = Math.min(
      shortestSide * 0.58,
      Math.max(shortestSide * 0.22, overlay.gripScale * 4.2),
    );
    const tip = {
      x: overlay.anchor.x + overlay.direction.x * bladeLength,
      y: overlay.anchor.y + overlay.direction.y * bladeLength,
    };
    this.trail.push(tip);
    if (this.trail.length > 18) this.trail.shift();
    this.drawTrail(context);

    const perpendicular = { x: -overlay.direction.y, y: overlay.direction.x };
    const handleLength = Math.max(18, overlay.gripScale * 0.7);
    const guardWidth = Math.max(18, overlay.gripScale * 0.55);
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

  reset() {
    this.trail.length = 0;
  }

  private drawTrail(context: CanvasRenderingContext2D) {
    if (this.trail.length < 2) return;
    context.save();
    context.lineCap = 'round';
    for (let index = 1; index < this.trail.length; index += 1) {
      const progress = index / this.trail.length;
      context.strokeStyle = `rgba(108, 201, 255, ${progress * 0.5})`;
      context.lineWidth = 1 + progress * 3;
      context.beginPath();
      context.moveTo(this.trail[index - 1].x, this.trail[index - 1].y);
      context.lineTo(this.trail[index].x, this.trail[index].y);
      context.stroke();
    }
    context.restore();
  }
}
