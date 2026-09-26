import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { AgentPane } from "@/components/shell/agent-pane";
import { ActivityLogs } from "@/components/activity-logs";
import { PlaceholderPane } from "@/components/shell/placeholder-pane";
import { SHELL_TABS, type ShellTab } from "@/components/shell/shell-tabs";
import { MapAmbientChrome } from "@/components/map-ambient-chrome";
import { CollectionsView } from "@/components/collections-view";
import { TimelineView } from "@/components/timeline-view";
import { useMissionMap } from "@/hooks/use-mission-map";
import type { Collection, NewCollection } from "@/lib/tauri";

export function HomeShell({
  activeTab,
  onTabChange,
  accountLabel,
  userName,
  avatarUrl,
  onSignOut,
  isActive,
  callState,
  label,
  subLabel,
  callError,
  onToggleCall,
  collections,
  collectionsError,
  selectedCollectionId,
  onSelectCollection,
  onCreateCollection,
  onArchiveCollection,
}: {
  activeTab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  accountLabel: string;
  userName?: string | null;
  avatarUrl?: string | null;
  onSignOut: () => void;
  isActive: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  onToggleCall: () => void;
  collections: Collection[];
  collectionsError?: string;
  selectedCollectionId: string | null;
  onSelectCollection: (id: string | null) => void;
  onCreateCollection: (form: NewCollection) => Promise<void>;
  onArchiveCollection: (id: string) => void;
}) {
  const { mapNode, mapReady, mapError } = useMissionMap();

  const handleMainDragMouseDown = (e: React.MouseEvent) => {
    if (
      e.button === 0 &&
      !(e.target as HTMLElement).closest(
        "button, a, input, select, textarea, [data-no-drag]",
      )
    ) {
      void getCurrentWindow().startDragging();
    }
  };

  const handleMainDoubleClick = (e: React.MouseEvent) => {
    if (
      !(e.target as HTMLElement).closest(
        "button, a, input, select, textarea, [data-no-drag]",
      )
    ) {
      void getCurrentWindow().toggleMaximize();
    }
  };

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
  } else if (activeTab === "timeline") {
    body = (
      <TimelineView
        collections={collections}
        onCollapse={() => onTabChange("agent")}
      />
    );
  } else if (activeTab === "collections") {
    const selected = collections.find((c) => c.id === selectedCollectionId);
    body = selected ? (
      <TimelineView
        key={selected.id}
        collection={selected}
        collections={collections}
        onBack={() => onSelectCollection(null)}
        onCollapse={() => onTabChange("agent")}
      />
    ) : (
      <CollectionsView
        collections={collections}
        error={collectionsError}
        onSelect={onSelectCollection}
        onCreate={onCreateCollection}
        onArchive={onArchiveCollection}
        onCollapse={() => onTabChange("agent")}
      />
    );
  } else {
    const tabMeta = SHELL_TABS.find((t) => t.id === activeTab);
    body = <PlaceholderPane label={tabMeta?.label ?? "This"} />;
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#0b0c0e]">
      {/* 3D Map in background */}
      <div
        ref={mapNode}
        className="vox-map-host absolute inset-0"
        style={{ background: "#0b0c0e" }}
      />

      <MapAmbientChrome />

      {/* Live transparent activity logs on the top right */}
      <ActivityLogs />

      {/* Foreground layout: Sidebar on the left + Main stage over the map */}
      <div className="pointer-events-none absolute inset-0 z-20 flex overflow-hidden">
        <AppSidebar
          activeTab={activeTab}
          onTabChange={onTabChange}
          accountLabel={accountLabel}
          userName={userName}
          avatarUrl={avatarUrl}
          onSignOut={onSignOut}
        />

        <div className="pointer-events-none relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          {/* Top window drag region across the rest of the window */}
          <div
            data-tauri-drag-region
            onMouseDown={handleMainDragMouseDown}
            onDoubleClick={handleMainDoubleClick}
            className="pointer-events-auto h-10 w-full shrink-0 select-none"
          />

          {/* Main Stage over Map */}
          <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeTab === "agent" ? (
              <div className="pointer-events-none flex h-full w-full flex-col p-4 pt-0">
                {body}
              </div>
            ) : (
              <div className="pointer-events-auto flex h-full w-full flex-col overflow-hidden bg-[#07080a]">
                {body}
              </div>
            )}
          </div>
        </div>
      </div>

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
