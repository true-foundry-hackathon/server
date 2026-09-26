import { useState, type ReactNode } from "react";
import { AgentPane } from "@/components/shell/agent-pane";
import { IconTray } from "@/components/shell/icon-tray";
import { PlaceholderPane } from "@/components/shell/placeholder-pane";
import { SHELL_TABS, type ShellTab } from "@/components/shell/shell-tabs";
import { ShellHeader } from "@/components/shell/shell-header";
import { MapAmbientChrome } from "@/components/map-ambient-chrome";
import type { NewProjectForm } from "@/components/new-project-dialog";
import { ProjectDetailView } from "@/components/project-detail-view";
import { ProjectsView } from "@/components/projects-view";
import { SystemMonitorWidget } from "@/components/system-monitor-widget";
import { TasksView } from "@/components/tasks-view";
import { useMissionMap } from "@/hooks/use-mission-map";
import type { Collection, DesktopTask } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { WIDGET_GLASS, WIDGET_RADIUS } from "@/lib/widget-style";

export function HomeShell({
  activeTab,
  onTabChange,
  accountLabel,
  onSignOut,
  isActive,
  callState,
  label,
  subLabel,
  callError,
  onToggleCall,
  pendingCount,
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
  onReloadTasks,
  onNewTask,
  onPageChange,
  onToggleTaskStatus,
  onInspectTask,
  collections,
  projectsError,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onArchiveProject,
}: {
  activeTab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  accountLabel: string;
  onSignOut: () => void;
  isActive: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  onToggleCall: () => void;
  pendingCount: number;
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
  onReloadTasks: () => void;
  onNewTask: () => void;
  onPageChange: (page: number) => void;
  onToggleTaskStatus: (task: DesktopTask) => void;
  onInspectTask: (task: DesktopTask) => void;
  collections: Collection[];
  projectsError?: string;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onCreateProject: (form: NewProjectForm) => Promise<void>;
  onArchiveProject: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { mapNode, mapReady, mapError } = useMissionMap();

  let body: ReactNode;
  if (activeTab === "agent") {
    body = (
      <AgentPane
        isActive={isActive}
        callState={callState}
        label={label}
        subLabel={subLabel}
        callError={callError}
        onToggleCall={onToggleCall}
      />
    );
  } else if (activeTab === "tasks") {
    body = (
      <TasksView
        tasks={tasks}
        totalTasks={totalTasks}
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        filter={filter}
        search={search}
        tasksLoading={tasksLoading}
        onFilterChange={onFilterChange}
        onSearchChange={onSearchChange}
        onReload={onReloadTasks}
        onNewTask={onNewTask}
        onCollapse={() => onTabChange("agent")}
        onPageChange={onPageChange}
        onToggleStatus={onToggleTaskStatus}
        onInspect={onInspectTask}
      />
    );
  } else if (activeTab === "projects") {
    body = selectedProjectId ? (
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
        onBack={() => onSelectProject(null)}
        onInspectTask={onInspectTask}
      />
    ) : (
      <ProjectsView
        collections={collections}
        error={projectsError}
        onSelectProject={onSelectProject}
        onCreateProject={onCreateProject}
        onArchiveProject={onArchiveProject}
        onCollapse={() => onTabChange("agent")}
      />
    );
  } else {
    const tabMeta = SHELL_TABS.find((t) => t.id === activeTab);
    body = <PlaceholderPane label={tabMeta?.label ?? "This"} />;
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#0b0c0e]">
      <div
        ref={mapNode}
        className="vox-map-host absolute inset-0"
        style={{ background: "#0b0c0e" }}
      />
      <MapAmbientChrome />

      <div className="no-drag pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col p-3.5">
        <div className="pointer-events-auto">
          <ShellHeader
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((v) => !v)}
            accountLabel={accountLabel}
            onSignOut={onSignOut}
          />
        </div>
        {!collapsed ? (
          <div
            className={cn(
              "pointer-events-auto relative mt-2.5 flex h-[380px] overflow-hidden",
              WIDGET_GLASS,
              WIDGET_RADIUS,
            )}
          >
            <IconTray
              activeTab={activeTab}
              onTabChange={onTabChange}
              pendingCount={pendingCount}
            />
            <div className="flex min-h-0 flex-1 flex-col border-l border-white/10">
              {body}
            </div>
          </div>
        ) : null}
      </div>

      <SystemMonitorWidget />

      {!mapReady && !mapError ? (
        <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
            Loading map…
          </p>
        </div>
      ) : null}

      {mapError ? (
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-void-black/85 px-8 text-center">
          <p className="max-w-md text-sm text-ash">{mapError}</p>
        </div>
      ) : null}
    </div>
  );
}
