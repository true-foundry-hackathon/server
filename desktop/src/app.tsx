import { useEffect, useState } from "react";
import { HomeShell } from "@/components/home-shell";
import { InspectTaskDialog } from "@/components/inspect-task-dialog";
import { NewTaskDialog, type NewTaskForm } from "@/components/new-task-dialog";
import type { ShellTab } from "@/components/shell/shell-tabs";
import { SignInScreen } from "@/components/sign-in-screen";
import { useAuth } from "@/hooks/use-auth";
import { useCallSession } from "@/hooks/use-call-session";
import { useProjects } from "@/hooks/use-projects";
import { PAGE_SIZE, useTasks } from "@/hooks/use-tasks";
import { statusLabel } from "@/lib/status";
import type { DesktopTask } from "@/lib/tauri";

const emptyNewTask: NewTaskForm = {
  title: "",
  instruction: "",
  execType: "autonomous",
  collectionId: "",
  due: "Today",
};

export default function App() {
  const auth = useAuth();
  const callSession = useCallSession(auth.auth.signed_in);

  const [activeTab, setActiveTab] = useState<ShellTab>("agent");
  const tasksHook = useTasks(auth.auth.signed_in, activeTab);
  const projectsHook = useProjects(auth.auth.signed_in);

  const [showNewTask, setShowNewTask] = useState(false);
  const [inspectTask, setInspectTask] = useState<DesktopTask | null>(null);
  const [newTask, setNewTask] = useState<NewTaskForm>(emptyNewTask);

  const { auth: authState, authBusy, authError, googleSignIn, signOut } = auth;
  const {
    callState,
    isActive,
    isBusy,
    isSpeaking,
    callError,
    toggleCall,
    endCall,
  } = callSession;
  const {
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
  } = tasksHook;
  const {
    collections,
    selectedProjectId,
    setSelectedProjectId,
    projectsError,
    createProject,
    archiveProject,
  } = projectsHook;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Enter" &&
        authState.signed_in &&
        activeTab === "agent" &&
        !isActive &&
        !isBusy
      ) {
        void toggleCall();
      } else if (e.key === "Escape") {
        if (showNewTask) setShowNewTask(false);
        else if (inspectTask) setInspectTask(null);
        else if (activeTab === "projects" && selectedProjectId)
          setSelectedProjectId(null);
        else if (activeTab !== "agent") setActiveTab("agent");
        else if (isActive || callState === "connecting") void endCall();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers use latest state via closure refresh
  }, [
    authState.signed_in,
    activeTab,
    isActive,
    isBusy,
    showNewTask,
    inspectTask,
    callState,
    selectedProjectId,
  ]);

  async function handleGoogleSignIn() {
    await googleSignIn(loadTasks);
  }

  async function handleCreateTask() {
    const created = await createTask(newTask);
    if (created) {
      setNewTask(emptyNewTask);
      setShowNewTask(false);
    }
  }

  const label = statusLabel(callState, callError);
  const subLabel = isActive
    ? isSpeaking
      ? "Speaking… (listening)"
      : "Listening… speak naturally"
    : isBusy || callState === "connecting"
      ? "Establishing duplex audio link…"
      : "Press the button or hit Return to talk";

  if (!authState.signed_in) {
    return (
      <SignInScreen
        busy={authBusy}
        error={authError}
        onSignIn={() => void handleGoogleSignIn()}
      />
    );
  }

  return (
    <main
      className="relative h-full w-full overflow-hidden bg-void-black"
      tabIndex={0}
    >
      <HomeShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        accountLabel={authState.email ?? authState.user_id ?? "Signed in"}
        onSignOut={() => void signOut()}
        isActive={isActive}
        callState={callState}
        label={label}
        subLabel={subLabel}
        callError={callError}
        onToggleCall={() => void toggleCall()}
        pendingCount={pendingCount}
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
        onReloadTasks={() => void loadTasks()}
        onNewTask={() => setShowNewTask(true)}
        onPageChange={setPage}
        onToggleTaskStatus={(task) => void toggleTaskStatus(task)}
        onInspectTask={setInspectTask}
        collections={collections}
        projectsError={projectsError}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onCreateProject={createProject}
        onArchiveProject={(id) => void archiveProject(id)}
      />

      <NewTaskDialog
        open={showNewTask}
        form={newTask}
        collections={collections}
        onOpenChange={setShowNewTask}
        onChange={(patch) => setNewTask((prev) => ({ ...prev, ...patch }))}
        onSubmit={() => void handleCreateTask()}
      />

      <InspectTaskDialog
        task={inspectTask}
        onClose={() => setInspectTask(null)}
      />
    </main>
  );
}
