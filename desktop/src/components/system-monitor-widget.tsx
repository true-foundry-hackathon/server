import { useSystemStats } from "@/hooks/use-system-stats";
import { WidgetNoise } from "@/components/widget-illustrations";
import { cn } from "@/lib/utils";
import { WIDGET_GLASS, WIDGET_RADIUS } from "@/lib/widget-style";

const CHART_WIDTH = 200;
const CHART_HEIGHT = 56;

function toPoints(values: number[]): string {
  if (values.length < 2) return "";
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * CHART_WIDTH;
      const y = CHART_HEIGHT - (Math.min(100, Math.max(0, v)) / 100) * CHART_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function SystemMonitorWidget() {
  const history = useSystemStats();
  const latest = history[history.length - 1];

  const cpuPoints = toPoints(history.map((s) => s.cpu_percent));
  const ramPoints = toPoints(history.map((s) => s.ram_percent));
  const hasBattery = history.some((s) => s.battery_percent != null);
  const batteryPoints = hasBattery
    ? toPoints(history.map((s) => s.battery_percent ?? 0))
    : "";

  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-4 right-4 z-10 w-56 overflow-hidden p-4",
        WIDGET_GLASS,
        WIDGET_RADIUS,
      )}
    >
      <WidgetNoise />
      <span className="relative text-[10px] font-medium uppercase tracking-wide text-white/45">
        System
      </span>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="relative mt-2 h-14 w-full"
        preserveAspectRatio="none"
      >
        {cpuPoints ? (
          <polyline points={cpuPoints} fill="none" stroke="#ff6363" strokeWidth="1.5" />
        ) : null}
        {ramPoints ? (
          <polyline points={ramPoints} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
        ) : null}
        {batteryPoints ? (
          <polyline points={batteryPoints} fill="none" stroke="#34d399" strokeWidth="1.5" />
        ) : null}
      </svg>
      <div className="relative mt-2 flex items-center justify-between text-[10px]">
        <span className="text-[#ff6363]">
          CPU {latest ? Math.round(latest.cpu_percent) : "–"}%
        </span>
        <span className="text-[#60a5fa]">
          RAM {latest ? Math.round(latest.ram_percent) : "–"}%
        </span>
        {latest?.battery_percent != null ? (
          <span className="text-[#34d399]">
            BAT {Math.round(latest.battery_percent)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}
