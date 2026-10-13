// Screen-space handle helpers shared by Free Transform and Crop.

// Handle positions as fractions of a box: corners first so they win hit tests.
export const HANDLE_FRACTIONS = [
  [0, 0], [1, 0], [1, 1], [0, 1],
  [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5],
];

const HIT_RADIUS = 9;

// points: [{ fx, fy, sx, sy }] in screen coordinates.
export function hitHandle(points, sx, sy) {
  return points.find((p) => Math.hypot(p.sx - sx, p.sy - sy) <= HIT_RADIUS) ?? null;
}

export function drawBox(ctx, corners) {
  ctx.beginPath();
  corners.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.stroke();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "#3d8bfd";
  ctx.stroke();
}

export function drawHandles(ctx, points) {
  ctx.lineWidth = 1.5;
  for (const p of points) {
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#3d8bfd";
    ctx.beginPath();
    ctx.rect(Math.round(p.sx) - 4.5, Math.round(p.sy) - 4.5, 9, 9);
    ctx.fill();
    ctx.stroke();
  }
}

// Pick a resize cursor matching the direction from the box center to a handle.
export function resizeCursor(center, p) {
  const deg = ((Math.atan2(p.sy - center.sy, p.sx - center.sx) * 180) / Math.PI + 360) % 180;
  const cursors = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
  return cursors[Math.round(deg / 45) % 4];
}

export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4" stroke="#fff" stroke-width="4"/><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4" stroke="#000" stroke-width="1.75"/></g></svg>',
)}") 12 12, crosshair`;
