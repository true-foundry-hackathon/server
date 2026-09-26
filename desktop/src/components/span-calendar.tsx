import { useEffect, useMemo, useRef, useState } from "react";
import {
  layoutAllDay,
  layoutDay,
  startOfDay,
  type PlacedSpan,
} from "@/lib/span-layout";
import { categoryColor, formatAmount, formatTime } from "@/lib/span-format";
import type { Span } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const INDENT_PX = 12;
const GUTTER_PX = 52;

function isSameDay(a: Date, b: Date) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function SpanBlock({
  placed,
  hasChildren,
  onSelect,
}: {
  placed: PlacedSpan;
  hasChildren: boolean;
  onSelect: (span: Span) => void;
}) {
  const { span, top, height, left, width, depth, instant } = placed;
  const color = categoryColor(span.category);
  const inset = depth * INDENT_PX;
  const heightPx = Math.max(height * PX_PER_MIN - 2, 18);
  const amount = formatAmount(span);
  const planned = span.status === "planned" || span.status === "waiting_user";
  const muted = span.status === "cancelled";

  return (
    <button
      type="button"
      data-no-drag
      title={`${span.title} · ${formatTime(span.start_at)}${
        span.end_at ? `–${formatTime(span.end_at)}` : ""
      }${amount ? ` · ${amount}` : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(span);
      }}
      className={cn(
        "absolute overflow-hidden text-left transition hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric-sky",
        instant
          ? "flex items-center gap-1.5 rounded-full px-2"
          : "flex flex-col justify-start rounded-md px-2 py-1",
        planned && "border-dashed",
        muted && "opacity-45",
        span.status === "active" && "ring-1 ring-white/40",
        span.status === "failed" && "ring-1 ring-coral-pulse",
      )}
      style={{
        top: top * PX_PER_MIN + 1,
        height: instant ? 20 : heightPx,
        left: `calc(${left * 100}% + ${inset + 2}px)`,
        width: `calc(${width * 100}% - ${inset + 4}px)`,
        zIndex: depth + 1,
        background: `color-mix(in srgb, ${color} ${hasChildren ? 10 : instant ? 30 : 22}%, #111214)`,
        border: `1px ${planned ? "dashed" : "solid"} color-mix(in srgb, ${color} 45%, transparent)`,
        borderLeft: instant ? undefined : `3px solid ${color}`,
      }}
    >
      {instant ? (
        <>
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: color }}
          />
          <span
            className={cn(
              "truncate text-[11px] text-mist",
              muted && "line-through",
            )}
          >
            {amount ? (
              <strong className="mr-1 font-semibold">{amount}</strong>
            ) : null}
            {span.title}
          </span>
        </>
      ) : (
        <>
          <p
            className={cn(
              "truncate text-[11.5px] font-medium leading-tight text-pure-white",
              muted && "line-through",
            )}
          >
            {span.title}
          </p>
          {heightPx > 34 ? (
            <p className="truncate font-mono text-[10px] text-white/55">
              {formatTime(span.start_at)}
              {span.end_at ? `–${formatTime(span.end_at)}` : ""}
              {amount ? ` · ${amount}` : ""}
            </p>
          ) : null}
        </>
      )}
    </button>
  );
}

export function SpanCalendar({
  days,
  spans,
  onSelect,
  onCreateAt,
}: {
  days: Date[];
  spans: Span[];
  onSelect: (span: Span) => void;
  onCreateAt: (start: Date) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const earliest = spans
      .filter((s) => s.start_at)
      .map((s) => new Date(s.start_at!))
      .filter((d) => days.some((day) => isSameDay(day, d)))
      .map((d) => d.getHours())
      .sort((a, b) => a - b)[0];
    const hour =
      earliest ??
      (days.some((d) => isSameDay(d, new Date()))
        ? new Date().getHours() - 2
        : 8);
    el.scrollTop = Math.max(0, hour - 1) * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on range change
  }, [days[0]?.getTime(), days.length]);

  const perDay = useMemo(
    () =>
      days.map((day) => {
        const placed = layoutDay(spans, day);
        const parents = new Set(
          placed
            .map((p) => p.span.parent_id)
            .filter((id): id is string => !!id),
        );
        return { day, placed, parents };
      }),
    [days, spans],
  );
  const allDay = useMemo(() => layoutAllDay(spans, days), [spans, days]);
  const allDayRows = allDay.reduce((max, r) => Math.max(max, r.row + 1), 0);
  const columns = `${GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="grid border-b border-border"
        style={{ gridTemplateColumns: columns }}
      >
        <div />
        {days.map((day) => {
          const today = isSameDay(day, now);
          return (
            <div
              key={day.toISOString()}
              className="border-l border-border px-2 py-2"
            >
              <p className="font-mono text-[10px] uppercase tracking-wider text-smoke">
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </p>
              <p
                className={cn(
                  "text-lg leading-tight font-semibold",
                  today ? "text-electric-sky" : "text-mist",
                )}
              >
                {day.getDate()}
              </p>
            </div>
          );
        })}
      </div>

      {allDayRows > 0 ? (
        <div
          className="relative grid border-b border-border"
          style={{ gridTemplateColumns: columns, height: allDayRows * 24 + 6 }}
        >
          <p className="self-center pr-2 text-right font-mono text-[9px] uppercase text-smoke">
            all day
          </p>
          {allDay.map(({ span, startCol, endCol, row }) => (
            <button
              key={span.id}
              type="button"
              onClick={() => onSelect(span)}
              className="absolute h-5 truncate rounded px-2 text-left text-[11px] text-pure-white"
              style={{
                top: row * 24 + 3,
                left: `calc(${GUTTER_PX}px + (100% - ${GUTTER_PX}px) * ${startCol / days.length} + 2px)`,
                width: `calc((100% - ${GUTTER_PX}px) * ${(endCol - startCol + 1) / days.length} - 4px)`,
                background: `color-mix(in srgb, ${categoryColor(span.category)} 30%, #111214)`,
              }}
            >
              {span.title}
            </button>
          ))}
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative grid"
          style={{ gridTemplateColumns: columns, height: 24 * HOUR_PX }}
        >
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-smoke"
                style={{ top: h * HOUR_PX }}
              >
                {new Date(2000, 0, 1, h).toLocaleTimeString(undefined, {
                  hour: "numeric",
                })}
              </span>
            ))}
          </div>
          {perDay.map(({ day, placed, parents }) => {
            const today = isSameDay(day, now);
            const nowTop = (now.getTime() - startOfDay(day).getTime()) / 60_000;
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "relative border-l border-border",
                  today && "bg-white/[0.015]",
                )}
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, rgba(255,255,255,0.06) ${HOUR_PX - 1}px, rgba(255,255,255,0.06) ${HOUR_PX}px)`,
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const minutes =
                    Math.floor((e.clientY - rect.top) / PX_PER_MIN / 15) * 15;
                  onCreateAt(
                    new Date(startOfDay(day).getTime() + minutes * 60_000),
                  );
                }}
              >
                {placed.map((p) => (
                  <SpanBlock
                    key={p.span.id}
                    placed={p}
                    hasChildren={parents.has(p.span.id)}
                    onSelect={onSelect}
                  />
                ))}
                {today ? (
                  <div
                    className="pointer-events-none absolute right-0 left-0 z-50 h-px bg-coral-pulse"
                    style={{ top: nowTop * PX_PER_MIN }}
                  >
                    <span className="absolute -top-1 -left-1 size-2 rounded-full bg-coral-pulse" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
