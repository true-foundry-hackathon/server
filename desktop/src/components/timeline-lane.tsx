import { Badge } from "@/components/ui/badge";
import { statusBadgeVariant } from "@/lib/status";
import type { TimelineEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 28;

type PositionedEntry = TimelineEntry & {
  left: number;
  width: number;
  row: number;
};

function packRows(
  entries: TimelineEntry[],
  windowStart: Date,
  windowEnd: Date,
): PositionedEntry[] {
  const spanMs = windowEnd.getTime() - windowStart.getTime();
  const sorted = [...entries].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  const rowEnds: number[] = [];
  const positioned: PositionedEntry[] = [];

  for (const entry of sorted) {
    const startMs = new Date(entry.start_at).getTime();
    const endMs = entry.end_at ? new Date(entry.end_at).getTime() : startMs;

    let row = rowEnds.findIndex((end) => end <= startMs);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(endMs);
    } else {
      rowEnds[row] = endMs;
    }

    const left = ((startMs - windowStart.getTime()) / spanMs) * 100;
    const width = entry.end_at
      ? Math.max(((endMs - startMs) / spanMs) * 100, 0.6)
      : 0;
    positioned.push({ ...entry, left, width, row });
  }

  return positioned;
}

export function TimelineLane({
  label,
  entries,
  windowStart,
  windowEnd,
  nowLeftPercent,
}: {
  label: string;
  entries: TimelineEntry[];
  windowStart: Date;
  windowEnd: Date;
  nowLeftPercent: number | null;
}) {
  const positioned = packRows(entries, windowStart, windowEnd);
  const rowCount = Math.max(1, ...positioned.map((e) => e.row + 1));

  return (
    <div className="flex border-b border-border">
      <div className="w-24 shrink-0 border-r border-border px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-smoke">
        {label}
      </div>
      <div
        className="relative flex-1"
        style={{ height: `${rowCount * ROW_HEIGHT + 8}px` }}
      >
        {nowLeftPercent !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px border-l border-dashed border-coral-pulse"
            style={{ left: `${nowLeftPercent}%` }}
          />
        )}
        {positioned.map((entry) => (
          <Badge
            key={entry.id}
            variant={statusBadgeVariant(entry.kind)}
            title={entry.title}
            className={cn(
              "absolute h-6 justify-start overflow-hidden px-2",
              entry.width === 0 && "w-2.5 min-w-0 rounded-full px-0",
            )}
            style={{
              left: `${entry.left}%`,
              width: entry.width > 0 ? `${entry.width}%` : undefined,
              top: `${entry.row * ROW_HEIGHT + 4}px`,
            }}
          >
            {entry.width > 0 && (
              <span className="truncate">{entry.title}</span>
            )}
          </Badge>
        ))}
      </div>
    </div>
  );
}
