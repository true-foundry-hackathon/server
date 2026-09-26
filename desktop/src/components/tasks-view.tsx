import { Check, Clock, PanelLeftClose, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VoxLogo } from "@/components/vox-logo";
import { statusBadgeVariant } from "@/lib/status";
import type { DesktopTask } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export function TasksView({
  tasks,
  totalTasks,
  page,
  totalPages,
  pageSize,
  filter,
  search,
  tasksLoading,
  onFilterChange,
  onSearchChange,
  onReload,
  onNewTask,
  onCollapse,
  onPageChange,
  onToggleStatus,
  onInspect,
}: {
  tasks: DesktopTask[];
  totalTasks: number;
  page: number;
  totalPages: number;
  pageSize: number;
  filter: string;
  search: string;
  tasksLoading: boolean;
  onFilterChange: (filter: string) => void;
  onSearchChange: (search: string) => void;
  onReload: () => void;
  onNewTask: () => void;
  onCollapse: () => void;
  onPageChange: (page: number) => void;
  onToggleStatus: (task: DesktopTask) => void;
  onInspect: (task: DesktopTask) => void;
}) {
  const startIdx = (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, totalTasks);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-ink px-7 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Agent Tasks</h1>
          <Badge variant="secondary" className="font-mono">
            {totalTasks} tasks
          </Badge>
        </div>
        <div className="no-drag flex items-center gap-2.5">
          <Button variant="secondary" size="icon" onClick={onReload} title="Reload">
            <RefreshCw className="size-4" />
          </Button>
          <Button size="sm" className="shadow-btn-lift gap-1.5" onClick={onNewTask}>
            <Plus className="size-4" />
            New Task
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

      <div className="no-drag flex items-center justify-between gap-4 border-b border-border bg-obsidian px-7 py-3">
        <Tabs value={filter} onValueChange={onFilterChange}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="executing">Executing</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          className="h-8 max-w-80"
          placeholder="Filter tasks or instructions…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="no-drag min-h-0 flex-1 overflow-auto px-7 pb-6">
        {tasks.length === 0 ? (
          <EmptyTasks onNewTask={onNewTask} />
        ) : (
          <TaskTable
            tasks={tasks}
            onToggleStatus={onToggleStatus}
            onInspect={onInspect}
          />
        )}
      </div>

      <div className="no-drag flex items-center justify-between border-t border-border px-7 py-3">
        <p className="font-mono text-xs text-smoke">
          {totalTasks === 0
            ? "No tasks found"
            : `Showing ${startIdx}–${endIdx} of ${totalTasks} tasks`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || tasksLoading}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            ← Prev
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Button
              key={p}
              variant={p === page ? "secondary" : "ghost"}
              size="sm"
              className="min-w-8"
              disabled={tasksLoading}
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || tasksLoading}
            onClick={() => onPageChange(page + 1)}
          >
            Next →
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyTasks({ onNewTask }: { onNewTask: () => void }) {
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

function TaskTable({
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
