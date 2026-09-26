import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocalLlmCard } from "@/components/local-llm-card";
import { TimelineLane } from "@/components/timeline-lane";
import { useTimeline } from "@/hooks/use-timeline";
import type { TimelineEntry } from "@/lib/tauri";

const LANES: { source: TimelineEntry["source"]; label: string }[] = [
  { source: "task", label: "Tasks" },
  { source: "schedule", label: "Schedules" },
  { source: "reminder", label: "Reminders" },
  { source: "device", label: "Device" },
];

function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TimelineView() {
  const {
    entries,
    loading,
    windowStart,
    windowEnd,
    goToPreviousWindow,
    goToNextWindow,
    goToToday,
  } = useTimeline();

  const now = new Date();
  const spanMs = windowEnd.getTime() - windowStart.getTime();
  const nowLeftPercent =
    now >= windowStart && now <= windowEnd
      ? ((now.getTime() - windowStart.getTime()) / spanMs) * 100
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LocalLlmCard />
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <p className="font-mono text-xs text-smoke">
          {formatDay(windowStart)} – {formatDay(windowEnd)}
        </p>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={goToToday} disabled={loading}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={goToPreviousWindow}
            disabled={loading}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={goToNextWindow} disabled={loading}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 && !loading ? (
          <p className="p-6 text-center text-sm text-ash">
            Nothing on the timeline for this week.
          </p>
        ) : (
          LANES.map((lane) => (
            <TimelineLane
              key={lane.source}
              label={lane.label}
              entries={entries.filter((e) => e.source === lane.source)}
              windowStart={windowStart}
              windowEnd={windowEnd}
              nowLeftPercent={nowLeftPercent}
            />
          ))
        )}
      </div>
    </div>
  );
}
