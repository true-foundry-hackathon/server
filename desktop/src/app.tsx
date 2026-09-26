import { useCallback, useEffect, useState } from "react";
import type { DesktopView } from "@/components/app-sidebar";
import { DashboardView } from "@/components/dashboard-view";
import { InspectTaskDialog } from "@/components/inspect-task-dialog";
import { NewTaskDialog, type NewTaskForm } from "@/components/new-task-dialog";
import { SignInScreen } from "@/components/sign-in-screen";
import { TasksView } from "@/components/tasks-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { VoxOrbVisualState } from "@/components/vox-logo";
import { statusLabel } from "@/lib/status";
import {
  api,
  invokeErrorMessage,
  type AuthState,
  type Collection,
  type DesktopTask,
} from "@/lib/tauri";

const PAGE_SIZE = 10;

const emptyNewTask: NewTaskForm = {
  title: "",
  instruction: "",
  execType: "autonomous",
  collectionId: "",
  due: "Today",
};

export default function App() {
  const [auth, setAuth] = useState<AuthState>({
    signed_in: false,
    user_id: null,
    email: null,
    bridge_url: "",
    api_url: "",
  });
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [callState, setCallState] = useState("idle");
  const [isActive, setIsActive] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [callError, setCallError] = useState("");

  const [view, setView] = useState<DesktopView>("dashboard");
  const [tasks, setTasks] = useState<DesktopTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalTasks, setTotalTasks] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [inspectTask, setInspectTask] = useState<DesktopTask | null>(null);
  const [newTask, setNewTask] = useState<NewTaskForm>(emptyNewTask);
  const [collections, setCollections] = useState<Collection[]>([]);

  const loadCollections = useCallback(async () => {
    try {
      const res = await api.getCollections();
      setCollections(res);
    } catch {
      /* keep previous list */
    }
  }, []);

  useEffect(() => {
    if (auth.signed_in) void loadCollections();
  }, [auth.signed_in, loadCollections]);

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
    void api.centerWindow().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (auth.signed_in) void api.setWindowSize(1280, 940).catch(() => undefined);
    else void api.setWindowSize(800, 600).catch(() => undefined);
  }, [auth.signed_in]);

  useEffect(() => {
    if (auth.signed_in) return;
    const id = window.setInterval(() => {
      void api.getAuthState().then((next) => {
        if (next.signed_in) {
          setAuth(next);
          setAuthBusy(false);
          setAuthError("");
        }
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [auth.signed_in]);

  useEffect(() => {
    if (!auth.signed_in) return;
    const delay = isActive ? 90 : 800;
    const id = window.setInterval(() => {
      void api.callStatus().then((status) => {
        if (!status.state) return;
        setCallState(status.state);
        setIsActive(status.active);
        setIsSpeaking(status.is_speaking);
        if (status.state === "idle" || status.state === "ended") {
          setIsBusy(false);
          setIsSpeaking(false);
        }
      });
    }, delay);
    return () => window.clearInterval(id);
  }, [auth.signed_in, isActive]);

  useEffect(() => {
    if (!auth.signed_in) return;
    void loadTasks();
  }, [auth.signed_in, loadTasks]);

  useEffect(() => {
    if (!auth.signed_in || view !== "tasks") return;
    const id = window.setInterval(() => void loadTasks(), 3500);
    return () => window.clearInterval(id);
  }, [auth.signed_in, view, loadTasks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Enter" &&
        auth.signed_in &&
        view === "dashboard" &&
        !isActive &&
        !isBusy
      ) {
        void toggleCall();
      } else if (e.key === "Escape") {
        if (showNewTask) setShowNewTask(false);
        else if (inspectTask) setInspectTask(null);
        else if (showProfile) setShowProfile(false);
        else if (view === "tasks") setView("dashboard");
        else if (isActive || callState === "connecting") void endCall();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers use latest state via closure refresh
  }, [
    auth.signed_in,
    view,
    isActive,
    isBusy,
    showNewTask,
    inspectTask,
    showProfile,
    callState,
  ]);

  async function googleSignIn() {
    setAuthBusy(true);
    setAuthError("");
    try {
      const next = await api.signInWithGoogle();
      setAuth(next);
      await loadTasks();
    } catch (err) {
      setAuthError(invokeErrorMessage(err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    try {
      const next = await api.signOut();
      setAuth(next);
    } catch {
      /* ignore */
    }
    setIsActive(false);
    setIsBusy(false);
    setIsSpeaking(false);
    setCallState("idle");
    setCallError("");
    setShowProfile(false);
    setView("dashboard");
  }

  async function endCall() {
    await api.endCall();
    setCallState("idle");
    setIsActive(false);
    setIsBusy(false);
    setIsSpeaking(false);
    setCallError("");
  }

  async function toggleCall() {
    if (isActive) {
      await endCall();
      return;
    }
    if (isBusy || !auth.signed_in) return;
    setIsBusy(true);
    setCallError("");
    setCallState("connecting");
    try {
      const status = await api.startCall();
      if (status.state === "active" || status.active) {
        setCallState("active");
        setIsActive(true);
      } else {
        setCallState("idle");
        setIsActive(false);
        setCallError(invokeErrorMessage(status));
      }
    } catch (err) {
      setCallState("idle");
      setIsActive(false);
      setCallError(invokeErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function toggleTaskStatus(task: DesktopTask) {
    const next = task.status === "completed" ? "pending" : "completed";
    await api.updateTask({ task_id: task.id, status: next });
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)),
    );
    await loadTasks();
  }

  async function createTask() {
    const title = newTask.title.trim();
    if (!title) return;
    await api.createTask({
      title,
      instruction: newTask.instruction.trim() || undefined,
      execution_type: newTask.execType,
      collection_id: newTask.collectionId || undefined,
      due_at: newTask.due,
    });
    setNewTask(emptyNewTask);
    setShowNewTask(false);
    await loadTasks();
  }

  function handleViewChange(next: DesktopView) {
    setView(next);
    if (next === "tasks") void loadTasks();
  }

  const orbState: VoxOrbVisualState = isActive
    ? "active"
    : callState === "connecting" || isBusy
      ? "connecting"
      : callError
        ? "error"
        : "idle";

  const orbSpeed = isSpeaking
    ? 3.5
    : isActive
      ? 1
      : isBusy || callState === "connecting"
        ? 1.8
        : 0.35;
  const label = statusLabel(callState, callError);
  const subLabel = isActive
    ? isSpeaking
      ? "Speaking… (listening)"
      : "Listening… speak naturally"
    : isBusy || callState === "connecting"
      ? "Establishing duplex audio link…"
      : "Press the button or hit Return to talk";

  const accountLabel = auth.email ?? auth.user_id ?? "Signed in";

  if (!auth.signed_in) {
    return (
      <SignInScreen
        busy={authBusy}
        error={authError}
        onSignIn={() => void googleSignIn()}
      />
    );
  }

  return (
    <main className="relative flex h-full w-full overflow-hidden bg-void-black" tabIndex={0}>
      <div className="fixed inset-x-0 top-0 z-50 h-9" data-tauri-drag-region />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {view === "dashboard" ? (
          <DashboardView
            orbState={orbState}
            orbSpeed={orbSpeed}
            isActive={isActive}
            isSpeaking={isSpeaking}
            callState={callState}
            label={label}
            subLabel={subLabel}
            callError={callError}
            pendingCount={pendingCount}
            onToggleCall={() => void toggleCall()}
            onOpenTasks={() => handleViewChange("tasks")}
            onOpenSettings={() => setShowProfile((v) => !v)}
          />
        ) : (
          <TasksView
            tasks={tasks}
            totalTasks={totalTasks}
            page={page}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            filter={filter}
            search={search}
            tasksLoading={tasksLoading}
            onFilterChange={(v) => {
              setFilter(v);
              setPage(1);
            }}
            onSearchChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            onReload={() => void loadTasks()}
            onNewTask={() => setShowNewTask(true)}
            onCollapse={() => setView("dashboard")}
            onPageChange={setPage}
            onToggleStatus={(task) => void toggleTaskStatus(task)}
            onInspect={setInspectTask}
          />
        )}
      </section>

      {showProfile ? (
        <>
          <button
            type="button"
            className="absolute inset-0 z-40 cursor-default bg-black/30"
            aria-label="Close settings"
            onClick={() => setShowProfile(false)}
          />
          <Card className="shadow-key absolute bottom-8 right-8 z-50 w-64 gap-3 border-0 p-3.5">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-wide text-smoke">
                Signed In
              </p>
              <p className="truncate font-mono text-[12.5px] text-pure-white">
                {accountLabel}
              </p>
            </div>
            <Separator />
            <div className="space-y-1.5 rounded-md border border-border bg-obsidian px-2.5 py-2 font-mono text-[11px]">
              <div className="flex justify-between gap-3">
                <span className="text-smoke">Bridge</span>
                <span className="truncate text-mist">bridge.voxagent.in</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-smoke">Audio</span>
                <span className="text-mist">Opus 48kHz</span>
              </div>
            </div>
            <Button
              variant="destructive"
              className="h-8 w-full text-coral-pulse"
              onClick={() => void signOut()}
            >
              Sign Out
            </Button>
          </Card>
        </>
      ) : null}

      <NewTaskDialog
        open={showNewTask}
        form={newTask}
        collections={collections}
        onOpenChange={setShowNewTask}
        onChange={(patch) => setNewTask((prev) => ({ ...prev, ...patch }))}
        onSubmit={() => void createTask()}
      />

      <InspectTaskDialog task={inspectTask} onClose={() => setInspectTask(null)} />
    </main>
  );
}
