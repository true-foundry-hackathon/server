import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LocalLlmCard } from "@/components/local-llm-card";
import { SpanCalendar } from "@/components/span-calendar";
import { daysFrom, formatMoney } from "@/lib/span-format";
import { SpanDialog, type SpanDraft } from "@/components/span-dialog";
import { useSpans } from "@/hooks/use-spans";
import { addDays, startOfDay } from "@/lib/span-layout";
import { api, type Collection, type Span } from "@/lib/tauri";

type Range = 1 | 3 | 7;

function rangeLabel(days: Date[]): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const first = days[0].toLocaleDateString(undefined, opts);
  if (days.length === 1) {
    return days[0].toLocaleDateString(undefined, { weekday: "long", ...opts });
  }
  return `${first} – ${days[days.length - 1].toLocaleDateString(undefined, opts)}`;
}

function initialAnchor(
  collection: Collection | null | undefined,
  range: Range,
): Date {
  if (collection?.starts_at) return startOfDay(new Date(collection.starts_at));
  const today = startOfDay(new Date());
  return range === 7 ? addDays(today, -today.getDay()) : today;
}

function collectionDays(
  collection: Collection | null | undefined,
): number | null {
  if (!collection?.starts_at || !collection.ends_at) return null;
  const ms =
    startOfDay(new Date(collection.ends_at)).getTime() -
    startOfDay(new Date(collection.starts_at)).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function TimelineView({
  collection,
  collections,
  onBack,
  onCollapse,
}: {
  collection?: Collection | null;
  collections: Collection[];
  onBack?: () => void;
  onCollapse: () => void;
}) {
  const tripDays = collectionDays(collection);
  const [range, setRange] = useState<Range>(() =>
    tripDays ? (tripDays <= 1 ? 1 : tripDays <= 3 ? 3 : 7) : 7,
  );
  const [anchor, setAnchor] = useState(() => initialAnchor(collection, range));
  const [selected, setSelected] = useState<Span | null>(null);
  const [draft, setDraft] = useState<SpanDraft | null>(null);

  const days = useMemo(() => daysFrom(anchor, range), [anchor, range]);
  const from = days[0].toISOString();
  const to = addDays(days[days.length - 1], 1).toISOString();

  const scheduled = useSpans({ from, to, collectionId: collection?.id });
  const unscheduled = useSpans({
    unscheduled: true,
    collectionId: collection?.id,
  });
  const openTodos = unscheduled.spans.filter(
    (s) => s.status !== "done" && s.status !== "cancelled",
  );

  const reload = () => {
    void scheduled.reload();
    void unscheduled.reload();
  };

  const spent = scheduled.spans.reduce(
    (sum, s) => sum + (typeof s.data?.amount === "number" ? s.data.amount : 0),
    0,
  );

  async function toggleDone(span: Span) {
    await api.updateSpan(span.id, {
      status: span.status === "done" ? "planned" : "done",
    });
    reload();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-ink px-6 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? (
            <Button
              variant="secondary"
              size="icon"
              onClick={onBack}
              title="Back to Collections"
            >
              <ArrowLeft className="size-4" />
            </Button>
          ) : null}
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {collection ? collection.name : "Timeline"}
          </h1>
          {collection ? (
            <Badge variant="outline">{collection.kind}</Badge>
          ) : null}
          {spent > 0 ? (
            <Badge variant="secondary" className="font-mono">
              {formatMoney(spent)} spent
            </Badge>
          ) : null}
        </div>
        <div className="no-drag flex items-center gap-2">
          <Tabs
            value={String(range)}
            onValueChange={(v) => setRange(Number(v) as Range)}
          >
            <TabsList>
              <TabsTrigger value="1">Day</TabsTrigger>
              <TabsTrigger value="3">3 days</TabsTrigger>
              <TabsTrigger value="7">Week</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAnchor(initialAnchor(collection, range))}
          >
            {collection ? "Start" : "Today"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="Previous"
            onClick={() => setAnchor((a) => addDays(a, -range))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="Next"
            onClick={() => setAnchor((a) => addDays(a, range))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            size="sm"
            className="shadow-btn-lift gap-1.5"
            onClick={() =>
              setDraft({ start: null, collectionId: collection?.id })
            }
          >
            <Plus className="size-4" />
            New
          </Button>
          <Button
            variant="secondary"
            size="icon"
            title="Collapse to Dashboard (Esc)"
            onClick={onCollapse}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      </header>

      {collection ? null : <LocalLlmCard />}

      <div className="flex min-h-0 flex-1">
        <div className="no-drag flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-4 py-2">
            <p className="font-mono text-xs text-smoke">{rangeLabel(days)}</p>
            {scheduled.error ? (
              <p className="text-xs text-coral-pulse">{scheduled.error}</p>
            ) : null}
          </div>
          <SpanCalendar
            days={days}
            spans={scheduled.spans}
            onSelect={setSelected}
            onCreateAt={(start) =>
              setDraft({ start, collectionId: collection?.id })
            }
          />
        </div>

        <aside className="no-drag flex w-64 shrink-0 flex-col border-l border-border bg-obsidian/40">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-[12.5px] font-medium text-mist">To-do</p>
            <span className="font-mono text-[10px] text-smoke">
              {openTodos.length} open
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {openTodos.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-smoke">
                Nothing unscheduled. Anything without a time lands here.
              </p>
            ) : (
              openTodos.map((span) => (
                <div
                  key={span.id}
                  className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.04]"
                >
                  <input
                    type="checkbox"
                    aria-label={`Mark ${span.title} done`}
                    checked={span.status === "done"}
                    onChange={() => void toggleDone(span)}
                    className="mt-0.5 size-3.5 accent-electric-sky"
                  />
                  <button
                    type="button"
                    onClick={() => setSelected(span)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[12.5px] text-mist">
                      {span.title}
                    </p>
                    {span.due_at ? (
                      <p className="font-mono text-[10px] text-smoke">
                        due{" "}
                        {new Date(span.due_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    ) : null}
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      <SpanDialog
        span={selected}
        draft={draft}
        collections={collections}
        onClose={() => {
          setSelected(null);
          setDraft(null);
        }}
        onSaved={reload}
      />
    </div>
  );
}
