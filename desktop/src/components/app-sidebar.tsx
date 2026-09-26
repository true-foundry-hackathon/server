import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Database,
  FolderKanban,
  Home,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CoralDiamond } from "@/components/icons";
import { windowControls } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export type DesktopView = "dashboard" | "tasks" | "projects";
export type SidebarSectionId = "lms" | "data" | "analytics";

const SECTIONS: {
  id: SidebarSectionId;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  {
    id: "lms",
    label: "LMS",
    hint: "Notes, whiteboards, collections",
    icon: BookOpen,
  },
  {
    id: "data",
    label: "Data",
    hint: "Finance, travel, process history",
    icon: Database,
  },
  {
    id: "analytics",
    label: "Analytics",
    hint: "Live reports and graphs",
    icon: BarChart3,
  },
];

export function AppSidebar({
  view,
  pendingCount,
  activeSection,
  showProfile,
  accountLabel,
  bridgeUrl,
  onViewChange,
  onSelectSection,
  onToggleProfile,
  onSignOut,
}: {
  view: DesktopView;
  pendingCount: number;
  activeSection: SidebarSectionId | null;
  showProfile: boolean;
  accountLabel: string;
  bridgeUrl: string;
  onViewChange: (view: DesktopView) => void;
  onSelectSection: (id: SidebarSectionId | null) => void;
  onToggleProfile: () => void;
  onSignOut: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const initials = accountLabel.replace(/@.*/, "").slice(0, 2).toUpperCase();

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col overflow-hidden border-r border-border-subtle/70 bg-ink transition-[width] duration-200 ease-out",
        expanded ? "w-56" : "w-16",
      )}
    >
      <div
        className="sign-in-noise pointer-events-none absolute inset-0 opacity-30"
        aria-hidden
      />

      <div
        data-tauri-drag-region
        className="relative z-10 flex h-11 shrink-0 items-center gap-1.5 px-3"
      >
        <button
          type="button"
          title="Close"
          onClick={() => void windowControls.close()}
          className="size-3 rounded-full bg-[#ff5f57] transition hover:brightness-110"
        />
        <button
          type="button"
          title="Minimize"
          onClick={() => void windowControls.minimize()}
          className="size-3 rounded-full bg-[#febc2e] transition hover:brightness-110"
        />
        <button
          type="button"
          title="Maximize"
          onClick={() => void windowControls.toggleMaximize()}
          className="size-3 rounded-full bg-[#28c840] transition hover:brightness-110"
        />
        <div className="flex-1" />
        <button
          type="button"
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          onClick={() => setExpanded((v) => !v)}
          className="flex size-6 items-center justify-center rounded-md text-smoke transition hover:bg-obsidian hover:text-pure-white"
        >
          {expanded ? (
            <PanelLeftClose className="size-3.5" />
          ) : (
            <PanelLeftOpen className="size-3.5" />
          )}
        </button>
      </div>

      <div className="relative z-10 flex flex-1 flex-col overflow-hidden px-2 pb-2">
        <button
          type="button"
          title="Vox Cockpit"
          onClick={() => onViewChange("dashboard")}
          className="mb-3 flex h-10 shrink-0 items-center gap-2.5 rounded-md px-2.5 transition hover:bg-obsidian"
        >
          <CoralDiamond />
          {expanded ? (
            <span className="truncate text-[13px] font-medium text-pure-white">
              Vox
            </span>
          ) : null}
        </button>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          <SidebarRow
            icon={Home}
            label="Home"
            expanded={expanded}
            active={view === "dashboard" && !activeSection}
            onClick={() => onViewChange("dashboard")}
          />
          <SidebarRow
            icon={ListTodo}
            label="Tasks"
            expanded={expanded}
            active={view === "tasks"}
            badge={pendingCount > 0 ? pendingCount : undefined}
            onClick={() => onViewChange("tasks")}
          />
          <SidebarRow
            icon={FolderKanban}
            label="Projects"
            hint="Tasks, notes, and datasets by project"
            expanded={expanded}
            active={view === "projects"}
            onClick={() => onViewChange("projects")}
          />
          <Separator className="my-1.5" />
          {SECTIONS.map((s) => (
            <SidebarRow
              key={s.id}
              icon={s.icon}
              label={s.label}
              hint={s.hint}
              expanded={expanded}
              active={activeSection === s.id}
              onClick={() =>
                onSelectSection(activeSection === s.id ? null : s.id)
              }
            />
          ))}
        </nav>
      </div>

      <div className="relative z-10 shrink-0 border-t border-border-subtle/60 px-2 py-2.5">
        <div className="relative">
          <button
            type="button"
            onClick={onToggleProfile}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-obsidian",
              showProfile && "bg-obsidian",
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-graphite font-mono text-[10.5px] font-medium text-pure-white">
              {initials}
            </span>
            {expanded ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-pure-white">
                  {accountLabel}
                </span>
                <span className="block truncate text-[10px] text-smoke">
                  Vox Desktop v{__APP_VERSION__}
                </span>
              </span>
            ) : null}
          </button>

          {showProfile ? (
            <Card className="shadow-key absolute bottom-2 left-14 z-[999] w-60 gap-3 border-0 p-3.5">
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
                <div className="flex justify-between">
                  <span className="text-smoke">Bridge</span>
                  <span className="text-mist">{bridgeUrl}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-smoke">Audio</span>
                  <span className="text-mist">Opus 48kHz</span>
                </div>
              </div>
              <Button
                variant="destructive"
                className="h-8 w-full text-coral-pulse"
                onClick={onSignOut}
              >
                Sign Out
              </Button>
            </Card>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function SidebarRow({
  icon: Icon,
  label,
  hint,
  expanded,
  active,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  expanded: boolean;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={hint ?? label}
      onClick={onClick}
      className={cn(
        "group relative flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2 text-ash transition",
        active
          ? "bg-graphite text-pure-white"
          : "hover:bg-obsidian hover:text-pure-white",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>
      {expanded ? (
        <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
      ) : null}
      {badge != null ? (
        <span
          className={cn(
            "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-coral-pulse px-1 font-mono text-[9.5px] font-semibold text-white shadow-[0_0_6px_rgba(255,99,99,0.5)]",
            !expanded && "absolute right-0.5 top-0.5",
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
