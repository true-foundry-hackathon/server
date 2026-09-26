import { PanelLeftClose, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyTasks, TaskTable } from "@/components/task-table";
import type { DesktopTask } from "@/lib/tauri";

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
