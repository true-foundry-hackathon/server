import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ShellTab } from "@/components/shell/shell-tabs";
import type { NewTaskForm } from "@/components/new-task-dialog";
import { api, type DesktopTask } from "@/lib/tauri";

export const PAGE_SIZE = 10;

export function useTasks(signedIn: boolean, view: ShellTab) {
  const [tasks, setTasks] = useState<DesktopTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalTasks, setTotalTasks] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const pendingCount = tasks.filter(
    (t) => t.status === "pending" || t.status === "executing",
  ).length;

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const res = await api.getTasks({
        page,
        page_size: PAGE_SIZE,
        status: filter === "all" ? undefined : filter,
        search: search.trim() || undefined,
      });
      setTasks(res.items ?? []);
      setTotalTasks(res.total ?? 0);
      setTotalPages(Math.max(1, res.total_pages ?? 1));
      if (res.page > 0) setPage(res.page);
    } catch {
      /* keep cache */
    } finally {
      setTasksLoading(false);
    }
  }, [page, filter, search]);

  useEffect(() => {
    if (signedIn) void loadTasks();
  }, [signedIn, loadTasks]);

  useEffect(() => {
    if (!signedIn || view !== "tasks") return;
    const id = window.setInterval(() => void loadTasks(), 3500);
    return () => window.clearInterval(id);
  }, [signedIn, view, loadTasks]);

  // Live push from vox-core (see src-tauri/src/live_link.rs): a task added
  // or updated anywhere — a phone call, another device — refetches
  // immediately instead of waiting for the poll above.
  useEffect(() => {
    if (!signedIn) return;
    let unlisten: (() => void) | undefined;
    void listen<string>("vox-live-update", (event) => {
      try {
        const payload = JSON.parse(event.payload) as { type?: string };
        if (payload.type === "task_created" || payload.type === "task_updated") {
          void loadTasks();
        }
      } catch {
        /* ignore malformed frame */
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [signedIn, loadTasks]);

  async function toggleTaskStatus(task: DesktopTask) {
    const next = task.status === "completed" ? "pending" : "completed";
    await api.updateTask({ task_id: task.id, status: next });
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)),
    );
    await loadTasks();
  }

  // Returns whether the task was actually created, so the caller knows
  // whether to reset its form/dialog state.
  async function createTask(form: NewTaskForm): Promise<boolean> {
    const title = form.title.trim();
    if (!title) return false;
    await api.createTask({
      title,
      instruction: form.instruction.trim() || undefined,
      execution_type: form.execType,
      collection_id: form.collectionId || undefined,
      due_at: form.due,
    });
    await loadTasks();
    return true;
  }

  return {
    tasks,
    tasksLoading,
    page,
    setPage,
    totalTasks,
    totalPages,
    filter,
    setFilter,
    search,
    setSearch,
    pendingCount,
    loadTasks,
    createTask,
    toggleTaskStatus,
  };
}
