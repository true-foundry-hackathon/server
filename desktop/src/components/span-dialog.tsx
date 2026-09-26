import { useState } from "react";
import { Trash2 } from "lucide-react";
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
import { formatAmount } from "@/lib/span-format";
import {
  api,
  invokeErrorMessage,
  type Collection,
  type ExecutionType,
  type Span,
  type SpanStatus,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";

export type SpanDraft = { start: Date | null; collectionId?: string };

type Form = {
  title: string;
  notes: string;
  category: string;
  status: SpanStatus;
  start: string;
  end: string;
  execution: ExecutionType | "none";
  amount: string;
  collectionIds: string[];
};

const STATUSES: SpanStatus[] = [
  "planned",
  "active",
  "waiting_user",
  "done",
  "failed",
  "cancelled",
];
const CATEGORIES = [
  "todo",
  "meeting",
  "call",
  "meal",
  "expense",
  "ride",
  "travel",
  "visit",
  "reminder",
];

function toLocalInput(value: Date | string | null): string {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function formFor(span: Span | null, draft: SpanDraft | null): Form {
  if (span) {
    return {
      title: span.title,
      notes: span.notes,
      category: span.category,
      status: span.status,
      start: toLocalInput(span.start_at),
      end: toLocalInput(span.end_at),
      execution: span.execution_type ?? "none",
      amount:
        typeof span.data?.amount === "number" ? String(span.data.amount) : "",
      collectionIds: span.collection_ids,
    };
  }
  const start = draft?.start ?? null;
  return {
    title: "",
    notes: "",
    category: "todo",
    status: start && start < new Date() ? "done" : "planned",
    start: toLocalInput(start),
    end: start ? toLocalInput(new Date(start.getTime() + 60 * 60_000)) : "",
    execution: "none",
    amount: "",
    collectionIds: draft?.collectionId ? [draft.collectionId] : [],
  };
}

export function SpanDialog({
  span,
  draft,
  collections,
  onClose,
  onSaved,
}: {
  span: Span | null;
  draft: SpanDraft | null;
  collections: Collection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = !!span || !!draft;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="shadow-key border-0 bg-ink sm:max-w-lg"
        onEscapeKeyDown={(e) => e.stopPropagation()}
      >
        {open ? (
          <SpanForm
            span={span}
            draft={draft}
            collections={collections}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SpanForm({
  span,
  draft,
  collections,
  onClose,
  onSaved,
}: {
  span: Span | null;
  draft: SpanDraft | null;
  collections: Collection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formFor(span, draft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!form.title.trim()) {
      setError("Give it a title");
      return;
    }
    const start_at = fromLocalInput(form.start);
    const end_at = fromLocalInput(form.end);
    if (start_at && end_at && end_at < start_at) {
      setError("End must be after start");
      return;
    }
    const amount = form.amount.trim() === "" ? undefined : Number(form.amount);
    setBusy(true);
    try {
      if (span) {
        await api.updateSpan(span.id, {
          title: form.title.trim(),
          notes: form.notes,
          category: form.category.trim() || "general",
          status: form.status,
          start_at,
          end_at,
        });
        const before = new Set(span.collection_ids);
        const after = new Set(form.collectionIds);
        await Promise.all([
          ...form.collectionIds
            .filter((id) => !before.has(id))
            .map((id) => api.setSpanCollection(id, span.id, true)),
          ...span.collection_ids
            .filter((id) => !after.has(id))
            .map((id) => api.setSpanCollection(id, span.id, false)),
        ]);
      } else {
        await api.createSpan({
          title: form.title.trim(),
          notes: form.notes,
          category: form.category.trim() || "general",
          status: form.status,
          start_at,
          end_at,
          execution_type: form.execution === "none" ? null : form.execution,
          data:
            amount !== undefined && !Number.isNaN(amount)
              ? { amount, currency: "INR" }
              : {},
          collection_ids: form.collectionIds,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(invokeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!span) return;
    setBusy(true);
    try {
      await api.deleteSpan(span.id);
      onSaved();
      onClose();
    } catch (err) {
      setError(invokeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const amount = span ? formatAmount(span) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {span ? "Edit span" : "New span"}
          {span ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {span.source}
            </Badge>
          ) : null}
          {amount ? <Badge variant="secondary">{amount}</Badge> : null}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label>Title</Label>
          <Input
            autoFocus
            placeholder="e.g. Bike ride to Nandi Hills"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label>Start</Label>
            <Input
              type="datetime-local"
              value={form.start}
              onChange={(e) => set({ start: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>End</Label>
            <Input
              type="datetime-local"
              value={form.end}
              onChange={(e) => set({ end: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Input
              list="span-categories"
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
            />
            <datalist id="span-categories">
              {CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => v && set({ status: v as SpanStatus })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {span ? null : (
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>Vox should</Label>
              <Select
                value={form.execution}
                onValueChange={(v) =>
                  v && set({ execution: v as Form["execution"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Just log it</SelectItem>
                  <SelectItem value="autonomous">Do it for me</SelectItem>
                  <SelectItem value="interactive">
                    Do it, ask me first
                  </SelectItem>
                  <SelectItem value="manual_human">Remind me</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Amount (₹)</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Optional"
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </div>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label>Notes</Label>
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
        {collections.length > 0 ? (
          <div className="grid gap-1.5">
            <Label>Collections</Label>
            <div className="flex flex-wrap gap-1.5">
              {collections.map((c) => {
                const on = form.collectionIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set({
                        collectionIds: on
                          ? form.collectionIds.filter((id) => id !== c.id)
                          : [...form.collectionIds, c.id],
                      })
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs transition",
                      on
                        ? "border-electric-sky bg-electric-sky/15 text-pure-white"
                        : "border-border text-ash hover:text-pure-white",
                    )}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {error ? <p className="text-xs text-coral-pulse">{error}</p> : null}
      </div>
      <DialogFooter className="sm:justify-between">
        {span ? (
          <Button
            variant="ghost"
            className="gap-1.5 text-coral-pulse"
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="shadow-btn-lift"
            disabled={busy}
            onClick={() => void save()}
          >
            {span ? "Save" : "Add"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
