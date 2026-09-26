import { Check, Clock, Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VoxLogo } from "@/components/vox-logo";
import { statusBadgeVariant } from "@/lib/status";
import type { DesktopTask } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export function EmptyTasks({ onNewTask }: { onNewTask: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <VoxLogo size={54} />
      <h3 className="text-lg font-medium">No tasks found</h3>
      <p className="max-w-sm text-sm text-ash">
        Ask your Vox agent to create an autonomous task or click New Task to track one.
      </p>
      <Button className="shadow-btn-lift mt-2 gap-1.5" onClick={onNewTask}>
        <Plus className="size-4" />
        Create a Task
      </Button>
    </div>
  );
}

export function TaskTable({
  tasks,
  onToggleStatus,
  onInspect,
}: {
  tasks: DesktopTask[];
  onToggleStatus: (task: DesktopTask) => void;
  onInspect: (task: DesktopTask) => void;
}) {
  return (
    <table className="mt-3 w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-smoke">
          <th className="py-2 pr-3 font-medium">Status</th>
          <th className="py-2 pr-3 font-medium">Task & Instruction</th>
          <th className="py-2 pr-3 font-medium">Execution Type</th>
          <th className="py-2 pr-3 font-medium">Project</th>
          <th className="py-2 pr-3 font-medium">Due</th>
          <th className="py-2 font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const done = task.status === "completed";
          const exec = task.status === "executing";
          return (
            <tr
              key={task.id}
              className={cn("border-b border-border/60", done && "opacity-60")}
            >
              <td className="py-3 pr-3 align-top">
                <Badge
                  variant={statusBadgeVariant(task.status)}
                  className={cn(
                    exec && "border-coral-pulse/35 bg-ember-hush text-coral-pulse",
                    done && "border-success-green/28 bg-success-green/12 text-success-green",
                  )}
                >
                  {exec ? (
                    <span className="size-1.5 animate-pulse rounded-full bg-coral-pulse shadow-[0_0_6px_#ff6363]" />
                  ) : done ? (
                    <Check className="size-3" />
                  ) : null}
                  {task.status}
                </Badge>
              </td>
              <td className="py-3 pr-3 align-top">
                <div className="font-medium text-pure-white">{task.title}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-ash">
                  {task.instruction}
                </div>
              </td>
              <td className="py-3 pr-3 align-top">
                <Badge variant="outline" className="gap-1">
                  {task.execution_type === "autonomous" ? (
                    <Sparkles className="size-3 text-coral-pulse" />
                  ) : null}
                  {task.execution_type}
                </Badge>
              </td>
              <td className="py-3 pr-3 align-top">
                <Badge variant="outline">{task.project_name ?? "General"}</Badge>
              </td>
              <td className="py-3 pr-3 align-top">
                <div className="flex items-center gap-1.5 text-ash">
                  <Clock className="size-3.5" />
                  <span>{task.due_at ?? "—"}</span>
                </div>
              </td>
              <td className="py-3 align-top">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-8"
                    title={done ? "Reopen" : "Complete"}
                    onClick={() => onToggleStatus(task)}
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onInspect(task)}>
                    View
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
