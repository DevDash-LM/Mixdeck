/**
 * One requestAnimationFrame loop for every Meter on screen (instead of one loop each).
 * It stops when no meter is mounted and while the window is hidden (tray).
 */
type Draw = (now: number) => void;

const draws = new Set<Draw>();
let raf = 0;

function loop(now: number) {
  raf = 0;
  if (document.hidden || draws.size === 0) return;
  for (const d of draws) d(now);
  raf = requestAnimationFrame(loop);
}

function kick() {
  if (!raf && draws.size > 0 && !document.hidden) raf = requestAnimationFrame(loop);
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", kick);

/** Registers a per-frame draw callback; returns the unregister function. */
export function addMeterDraw(draw: Draw): () => void {
  draws.add(draw);
  kick();
  return () => {
    draws.delete(draw);
  };
}
