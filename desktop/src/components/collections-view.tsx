import { useState } from "react";
import { Archive, PanelLeftClose, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { VoxLogo } from "@/components/vox-logo";
import type { Collection, CollectionKind, NewCollection } from "@/lib/tauri";

type Form = {
  name: string;
  description: string;
  kind: CollectionKind;
  start: string;
  end: string;
};
const EMPTY: Form = {
  name: "",
  description: "",
  kind: "trip",
  start: "",
  end: "",
};

function dateRange(c: Collection): string | null {
  if (!c.starts_at) return null;
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const start = new Date(c.starts_at).toLocaleDateString(undefined, opts);
  return c.ends_at
    ? `${start} – ${new Date(c.ends_at).toLocaleDateString(undefined, opts)}`
    : `from ${start}`;
}

function toIso(date: string, endOfDay = false): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00`);
  if (endOfDay) d.setHours(23, 59, 59, 0);
  return d.toISOString();
}

export function CollectionsView({
  collections,
  error,
  onSelect,
  onCreate,
  onArchive,
  onCollapse,
}: {
  collections: Collection[];
  error?: string;
  onSelect: (id: string) => void;
  onCreate: (form: NewCollection) => Promise<void>;
  onArchive: (id: string) => void;
  onCollapse: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [formError, setFormError] = useState("");
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    if (!form.name.trim()) return setFormError("Give it a name");
    if (form.start && form.end && form.end < form.start)
      return setFormError("End must be after start");
    try {
      await onCreate({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        kind: form.kind,
        starts_at: toIso(form.start),
        ends_at: toIso(form.end, true),
      });
      setForm(EMPTY);
      setFormError("");
      setShowNew(false);
    } catch {
      /* error surfaced by the hook */
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-ink px-7 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Collections</h1>
          <Badge variant="secondary" className="font-mono">
            {collections.length}
          </Badge>
        </div>
        <div className="no-drag flex items-center gap-2.5">
          <Button
            size="sm"
            className="shadow-btn-lift gap-1.5"
            onClick={() => setShowNew(true)}
          >
            <Plus className="size-4" />
            New Collection
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

      {error ? (
        <p className="px-7 pt-3 text-xs text-coral-pulse">{error}</p>
      ) : null}

      <div className="no-drag min-h-0 flex-1 overflow-auto px-7 py-6">
        {collections.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <VoxLogo size={54} />
            <h3 className="text-lg font-medium">No collections yet</h3>
            <p className="max-w-sm text-sm text-ash">
              A collection gathers everything from one chapter of your life,
              like a trip: the rides, the meals, what you spent. Each one gets
              its own timeline.
            </p>
            <Button
              className="shadow-btn-lift mt-2 gap-1.5"
              onClick={() => setShowNew(true)}
            >
              <Plus className="size-4" />
              New Collection
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(c.id)}
                onKeyDown={(e) => e.key === "Enter" && onSelect(c.id)}
                className="group flex cursor-pointer flex-col items-start gap-2 rounded-xl border border-border bg-obsidian p-4 text-left transition hover:border-electric-sky/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric-sky"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate font-medium text-pure-white">
                    {c.name}
                  </span>
                  <Badge variant="outline">{c.kind}</Badge>
                </div>
                {c.description ? (
                  <p className="line-clamp-2 text-xs text-ash">
                    {c.description}
                  </p>
                ) : null}
                <div className="mt-auto flex w-full items-center justify-between pt-2">
                  <span className="font-mono text-[11px] text-smoke">
                    {[dateRange(c), `${c.span_count} entries`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                    title="Archive collection"
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive(c.id);
                    }}
                  >
                    <Archive className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent
          className="shadow-key border-0 bg-ink sm:max-w-lg"
          onEscapeKeyDown={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>New Collection</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Goa trip"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-1.5">
                <Label>Kind</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => v && set({ kind: v as CollectionKind })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trip">Trip</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="course">Course</SelectItem>
                    <SelectItem value="area">Area</SelectItem>
                    <SelectItem value="custom">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>From</Label>
                <Input
                  type="date"
                  value={form.start}
                  onChange={(e) => set({ start: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>To</Label>
                <Input
                  type="date"
                  value={form.end}
                  onChange={(e) => set({ end: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </div>
            {formError ? (
              <p className="text-xs text-coral-pulse">{formError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button className="shadow-btn-lift" onClick={() => void submit()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
