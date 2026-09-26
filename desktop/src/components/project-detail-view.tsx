import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskTable } from "@/components/task-table";
import { api, type Collection, type DesktopTask } from "@/lib/tauri";

function ComingLater({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-sm text-ash">{label} — coming in a later update.</p>
    </div>
  );
}

export function ProjectDetailView({
  project,
  onBack,
  onInspectTask,
}: {
  project: Collection;
  onBack: () => void;
  onInspectTask: (task: DesktopTask) => void;
}) {
  const [tasks, setTasks] = useState<DesktopTask[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getTasks({
        page: 1,
        page_size: 50,
        collection_id: project.id,
      });
      setTasks(res.items ?? []);
    } catch {
      /* keep previous list */
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function toggleStatus(task: DesktopTask) {
    await api.updateTask({
      task_id: task.id,
      status: task.status === "completed" ? "pending" : "completed",
    });
    await loadTasks();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-ink px-7 py-4">
        <Button
          variant="secondary"
          size="icon"
          onClick={onBack}
          title="Back to Projects"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
        <Badge variant="secondary">{project.status}</Badge>
        <Badge variant="outline">{project.kind}</Badge>
      </header>

      <div className="no-drag min-h-0 flex-1 overflow-auto px-7 py-6">
        <Tabs defaultValue="tasks">
          <TabsList>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="datasets">Datasets</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="tasks">
            {loading ? null : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <p className="text-sm text-ash">
                  No tasks in this project yet.
                </p>
              </div>
            ) : (
              <TaskTable
                tasks={tasks}
                onToggleStatus={(t) => void toggleStatus(t)}
                onInspect={onInspectTask}
              />
            )}
          </TabsContent>
          <TabsContent value="notes">
            <ComingLater label="Notes" />
          </TabsContent>
          <TabsContent value="datasets">
            <ComingLater label="Datasets" />
          </TabsContent>
          <TabsContent value="analytics">
            <ComingLater label="Analytics" />
          </TabsContent>
          <TabsContent value="reports">
            <ComingLater label="Reports" />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
