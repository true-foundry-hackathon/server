import { useEffect, useState } from "react";
import {
  AppSidebar,
  type DesktopView,
  type SidebarSectionId,
} from "@/components/app-sidebar";
import { DashboardView } from "@/components/dashboard-view";
import { InspectTaskDialog } from "@/components/inspect-task-dialog";
import { NewTaskDialog, type NewTaskForm } from "@/components/new-task-dialog";
import { ProjectDetailView } from "@/components/project-detail-view";
import { ProjectsView } from "@/components/projects-view";
import { SignInScreen } from "@/components/sign-in-screen";
import { TasksView } from "@/components/tasks-view";
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

  const [view, setView] = useState<DesktopView>("dashboard");
  const tasksHook = useTasks(auth.auth.signed_in, view);
  const projectsHook = useProjects(auth.auth.signed_in);

  const [showProfile, setShowProfile] = useState(false);
  const [activeSection, setActiveSection] = useState<SidebarSectionId | null>(
    null,
  );
  const [showNewTask, setShowNewTask] = useState(false);
  const [inspectTask, setInspectTask] = useState<DesktopTask | null>(null);
  const [newTask, setNewTask] = useState<NewTaskForm>(emptyNewTask);

  const { auth: authState, authBusy, authError, googleSignIn } = auth;
  const {
    callState,
    isActive,
    isBusy,
    isSpeaking,
    callError,
    toggleCall,
    endCall,
    resetCallState,
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
    loadCollections,
    createProject,
    archiveProject,
  } = projectsHook;

  // Keyboard shortcuts: Enter-to-talk, Escape priority chain.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Enter" &&
        authState.signed_in &&
        view === "dashboard" &&
        !isActive &&
        !isBusy
      ) {
        void toggleCall();
      } else if (e.key === "Escape") {
        if (showNewTask) setShowNewTask(false);
        else if (inspectTask) setInspectTask(null);
        else if (showProfile) setShowProfile(false);
        else if (view === "projects" && selectedProjectId)
          setSelectedProjectId(null);
        else if (view === "projects") setView("dashboard");
        else if (view === "tasks") setView("dashboard");
        else if (isActive || callState === "connecting") void endCall();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers use latest state via closure refresh
  }, [
    authState.signed_in,
    view,
    isActive,
    isBusy,
    showNewTask,
    inspectTask,
    showProfile,
    callState,
    selectedProjectId,
  ]);

  async function handleGoogleSignIn() {
    await googleSignIn(loadTasks);
  }

  async function handleSignOut() {
    await auth.signOut();
    resetCallState();
    setShowProfile(false);
    setView("dashboard");
  }

  async function handleCreateTask() {
    const created = await createTask(newTask);
    if (created) {
      setNewTask(emptyNewTask);
      setShowNewTask(false);
    }
  }

  function handleViewChange(next: DesktopView) {
    setActiveSection(null);
    setView(next);
    if (next === "tasks") void loadTasks();
    if (next === "projects") {
      setSelectedProjectId(null);
      void loadCollections();
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

  const accountLabel = authState.email ?? authState.user_id ?? "Signed in";

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
      className="relative flex h-full w-full overflow-hidden bg-void-black"
      tabIndex={0}
    >
      <AppSidebar
        view={view}
        pendingCount={pendingCount}
        activeSection={activeSection}
        showProfile={showProfile}
        accountLabel={accountLabel}
        bridgeUrl={authState.bridge_url}
        onViewChange={handleViewChange}
        onSelectSection={setActiveSection}
        onToggleProfile={() => setShowProfile((v) => !v)}
        onSignOut={() => void handleSignOut()}
      />

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className="absolute inset-x-0 top-0 z-30 h-9"
          data-tauri-drag-region
        />
        {view === "dashboard" ? (
          <DashboardView
            isActive={isActive}
            isSpeaking={isSpeaking}
            callState={callState}
            label={label}
            subLabel={subLabel}
            callError={callError}
            activeSection={activeSection}
            onToggleCall={() => void toggleCall()}
          />
        ) : view === "tasks" ? (
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
        ) : selectedProjectId ? (
          <ProjectDetailView
            project={
              collections.find((c) => c.id === selectedProjectId) ?? {
                id: selectedProjectId,
                name: "Project",
                description: "",
                kind: "project",
                status: "active",
              }
            }
            onBack={() => setSelectedProjectId(null)}
            onInspectTask={setInspectTask}
          />
        ) : (
          <ProjectsView
            collections={collections}
            error={projectsError}
            onSelectProject={setSelectedProjectId}
            onCreateProject={createProject}
            onArchiveProject={(id) => void archiveProject(id)}
            onCollapse={() => setView("dashboard")}
          />
        )}
      </section>

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
