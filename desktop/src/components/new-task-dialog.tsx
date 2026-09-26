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
import type { Collection } from "@/lib/tauri";

export type NewTaskForm = {
  title: string;
  instruction: string;
  execType: string;
  collectionId: string;
  due: string;
};

export function NewTaskDialog({
  open,
  form,
  collections,
  onOpenChange,
  onChange,
  onSubmit,
}: {
  open: boolean;
  form: NewTaskForm;
  collections: Collection[];
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<NewTaskForm>) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="shadow-key border-0 bg-ink sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Agent Task</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Task Title</Label>
            <Input
              placeholder="e.g. Ingest daily call recordings"
              value={form.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Detailed Instruction</Label>
            <Textarea
              rows={3}
              placeholder="Instructions for the autonomous background agent…"
              value={form.instruction}
              onChange={(e) => onChange({ instruction: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>Execution Mode</Label>
              <Select
                value={form.execType}
                onValueChange={(v) => v && onChange({ execType: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="autonomous">Autonomous (Agent)</SelectItem>
                  <SelectItem value="interactive">
                    Interactive (Prompt User)
                  </SelectItem>
                  <SelectItem value="manual_human">Manual Tracking</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Project / Collection</Label>
              <Select
                value={form.collectionId || "none"}
                onValueChange={(v) =>
                  onChange({ collectionId: v === "none" ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Due Date / Window</Label>
            <Input
              value={form.due}
              onChange={(e) => onChange({ due: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="shadow-btn-lift" onClick={onSubmit}>
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
