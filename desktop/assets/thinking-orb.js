import { resolvePreset, MODE_DRAWS } from "./thinking-orbs-engine.js";

/**
 * Mount a thinking-orbs canvas animation. Returns an unmount function.
 * Mirrors the React ThinkingOrb loop from thinking-orbs.
 */
export function mountThinkingOrb(
  canvas,
  { state = "composing", size = 64, theme = "dark", speed = 1 } = {},
) {
  if (!canvas || typeof canvas.getContext !== "function") {
    return () => {};
  }

  const presetSize = size >= 24 ? 64 : 20;
  const dark = theme !== "light";
  const dpr = Math.min(2, (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1);
  canvas.width = Math.round(presetSize * dpr);
  canvas.height = Math.round(presetSize * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.display = "block";

  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const { mode, speed: baseSpeed, opts } = resolvePreset(state, presetSize);
  const draw = MODE_DRAWS[mode];
  const rate = baseSpeed * speed;

  const paint = (t) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, presetSize, presetSize);
    draw(ctx, presetSize, t, dark, opts);
  };

  const reduceMotion =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    paint(0.6);
    return () => {};
  }

  let raf = 0;
  let running = false;
  let visible = true;

  const tick = () => {
    paint((performance.now() / 1000) * rate);
    if (running) raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  paint((performance.now() / 1000) * rate);

  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          if (visible && document.visibilityState !== "hidden") start();
          else stop();
        })
      : null;
  io?.observe(canvas);

  const onVis = () => {
    if (document.visibilityState === "hidden") stop();
    else if (visible) start();
  };
  document.addEventListener("visibilitychange", onVis);
  if (!io) start();

  return () => {
    stop();
    io?.disconnect();
    document.removeEventListener("visibilitychange", onVis);
  };
}

if (typeof window !== "undefined") {
  window.__voxMountThinkingOrb = mountThinkingOrb;
}
