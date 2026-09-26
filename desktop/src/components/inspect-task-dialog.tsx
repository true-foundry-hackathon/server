import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { statusBadgeVariant } from "@/lib/status";
import type { DesktopTask } from "@/lib/tauri";

export function InspectTaskDialog({
  task,
  onClose,
}: {
  task: DesktopTask | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="shadow-key border-0 bg-ink sm:max-w-lg">
        {task ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Badge variant={statusBadgeVariant(task.status)}>
                  {task.status}
                </Badge>
                <DialogTitle>{task.title}</DialogTitle>
              </div>
            </DialogHeader>
            <div className="grid gap-4 text-sm">
              <div>
                <Label>Instruction</Label>
                <p className="mt-1 text-ash">{task.instruction}</p>
              </div>
              {task.feasibility_reasoning ? (
                <div>
                  <Label>Agent Feasibility & Reasoning</Label>
                  <p className="mt-1 text-ash">{task.feasibility_reasoning}</p>
                </div>
              ) : null}
              {task.execution_result != null ? (
                <div>
                  <Label>Execution Result Payload</Label>
                  <pre className="mt-1 overflow-auto rounded-md bg-obsidian p-3 font-mono text-xs text-mist">
                    {JSON.stringify(task.execution_result, null, 2)}
                  </pre>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-obsidian p-3 font-mono text-xs">
                <Meta k="Execution Type" v={task.execution_type} />
                <Meta k="Project" v={task.project_name ?? "None"} />
                <Meta k="Due" v={task.due_at ?? "—"} />
                <Meta k="Task ID" v={task.id} />
              </div>
            </div>
            <DialogFooter>
              <Button className="shadow-btn-lift" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-smoke">{k}</div>
      <div className="mt-0.5 break-all text-mist">{v}</div>
    </div>
  );
}
