import { useEffect, useRef } from "react";

export function paintDeleteDropDots(
  canvas: HTMLCanvasElement,
  pointer?: { x: number; y: number },
) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const { left, top, width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const scale = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.save();
  const button = canvas.parentElement?.querySelector("#delete-accounts");
  if (button) {
    const bounds = button.getBoundingClientRect();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.roundRect(
      bounds.left - left,
      bounds.top - top,
      bounds.width,
      bounds.height,
      bounds.height / 2,
    );
    context.clip("evenodd");
  }
  context.fillStyle = "#ff8f9c";

  const pitch = 11;
  const columns = Math.floor(width / pitch);
  const rows = Math.floor(height / pitch);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = (width - columns * pitch) / 2 + (column + 0.5) * pitch;
      const y = (height - rows * pitch) / 2 + (row + 0.5) * pitch;
      const dx = pointer ? pointer.x - left - x : 0;
      const dy = pointer ? pointer.y - top - y : 0;
      const lift = pointer ? Math.exp(-(dx * dx + dy * dy) / 4200) : 0;
      const edge = Math.min(1, Math.min(x, y, width - x, height - y) / 20);

      context.globalAlpha = edge * (0.21 + 0.56 * lift);
      context.beginPath();
      context.arc(
        x + dx * 0.08 * lift,
        y + dy * 0.08 * lift,
        0.62 + 1.45 * lift,
        0,
        2 * Math.PI,
      );
      context.fill();
    }
  }
  context.restore();
}

export function DeleteDropDots() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const redraw = () => paintDeleteDropDots(canvas);
    redraw();
    const resize = new ResizeObserver(redraw);
    resize.observe(canvas);
    return () => resize.disconnect();
  }, []);

  return <canvas ref={ref} className="account-delete-dots" aria-hidden="true" />;
}
