import { useEffect, useRef } from "react";
import {
  MODE_DRAWS,
  resolvePreset,
  type OrbState as ThinkingOrbState,
  type OrbTheme,
} from "thinking-orbs";
import { STATIC_ORB_DOTS } from "./vox-logo-dots";
import { cn } from "@/lib/utils";

export type VoxOrbVisualState = "idle" | "connecting" | "active" | "error";

function toThinkingState(state: VoxOrbVisualState): ThinkingOrbState {
  switch (state) {
    case "connecting":
      return "connecting";
    case "active":
      return "listening";
    case "error":
      return "shaping";
    default:
      return "composing";
  }
}

export function VoxOrbSvg({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={cn("text-mist", className)}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Vox"
    >
      {STATIC_ORB_DOTS.map(([cx, cy, r, op], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="currentColor"
          opacity={op}
        />
      ))}
    </svg>
  );
}

/**
 * thinking-orbs only paints at 20/32/64 CSS px. Stretching that canvas to
 * 120–240px is what made the hero logo look soft. We keep the 64px preset
 * math, but paint into a displaySize × dpr backing store so dots stay crisp.
 */
function HiResThinkingOrb({
  state,
  displaySize,
  theme = "dark",
  speed = 1,
  className,
}: {
  state: ThinkingOrbState;
  displaySize: number;
  theme?: OrbTheme;
  speed?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engineSize = displaySize >= 24 ? 64 : 20;
    const dark = theme !== "light";
    const dpr = Math.min(
      3,
      typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1,
    );
    const pixel = Math.round(displaySize * dpr);
    canvas.width = pixel;
    canvas.height = pixel;
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const { mode, speed: baseSpeed, opts } = resolvePreset(state, engineSize);
    const draw = MODE_DRAWS[mode];
    const scale = (displaySize / engineSize) * dpr;

    const paint = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pixel, pixel);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      draw(ctx, engineSize, t, dark, opts);
    };

    const reduceMotion =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      paint(0.6);
      return;
    }

    let raf = 0;
    let running = false;
    let visible = true;
    let last = performance.now();
    let sim = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      sim += dt * baseSpeed * speedRef.current;
      paint(sim);
      if (running) raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    paint(0);

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
    start();

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [state, displaySize, theme]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label="Vox"
      style={{ width: displaySize, height: displaySize, display: "block" }}
    />
  );
}

export function VoxLogo({
  animated = false,
  size = 28,
  theme = "dark",
  state = "idle",
  speed = 1,
  className,
}: {
  animated?: boolean;
  size?: number;
  theme?: "auto" | "light" | "dark";
  state?: VoxOrbVisualState;
  speed?: number;
  className?: string;
}) {
  if (!animated) {
    return <VoxOrbSvg size={size} className={className} />;
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-mist",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <HiResThinkingOrb
        state={toThinkingState(state)}
        displaySize={size}
        theme={theme}
        speed={speed}
      />
    </span>
  );
}
