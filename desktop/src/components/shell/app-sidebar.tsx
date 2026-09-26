import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  ChevronDown,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { windowControls } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { ShellTab } from "./shell-tabs";

const CONTROLS = [
  { title: "Close", color: "#ff5f57", action: windowControls.close },
  { title: "Minimize", color: "#febc2e", action: windowControls.minimize },
  {
    title: "Fullscreen",
    color: "#28c840",
    action: windowControls.toggleMaximize,
  },
] as const;

export function AppSidebar({
  activeTab,
  onTabChange,
  accountLabel = "Signed in",
  userName,
  avatarUrl,
  onSignOut,
}: {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  activeTab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  accountLabel?: string;
  userName?: string | null;
  avatarUrl?: string | null;
  onSignOut: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const displayName = (userName || accountLabel || "User")
    .replace(/@.*/, "")
    .trim();
  const initial = displayName
    ? displayName
        .split(/\s+/)
        .filter(Boolean)
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "U"
    : "U";

  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (
      e.button === 0 &&
      !(e.target as HTMLElement).closest(
        "button, a, input, select, textarea, [data-no-drag]",
      )
    ) {
      void getCurrentWindow().startDragging();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (
      !(e.target as HTMLElement).closest(
        "button, a, input, select, textarea, [data-no-drag]",
      )
    ) {
      void getCurrentWindow().toggleMaximize();
    }
  };

  return (
    <aside
      className={cn(
        "pointer-events-auto relative z-20 flex h-full w-72 shrink-0 flex-col overflow-hidden border-r border-white/10 select-none",
        "bg-[#07080a]/75 backdrop-blur-md shadow-2xl",
      )}
    >
      {/* Top Window Chrome / Drag Area */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDoubleClick}
        className="relative flex h-11 shrink-0 items-center justify-between px-3"
      >
        <div className="no-drag flex items-center gap-2" data-no-drag>
          {CONTROLS.map((control) => (
            <button
              key={control.title}
              type="button"
              title={control.title}
              onClick={() => void control.action()}
              className="size-2.5 rounded-full transition hover:brightness-110"
              style={{ backgroundColor: control.color }}
            />
          ))}
        </div>

        <div className="no-drag flex items-center gap-1.5" data-no-drag>
          <span className="font-reem text-[13px] font-semibold tracking-wide text-pure-white">
            Vox
          </span>
          <span className="font-mono text-[10px] text-white/40">
            v{__APP_VERSION__}
          </span>
        </div>
      </div>

      {/* Main Sidebar Body: Core Nav Links */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2 py-1.5">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onTabChange("agent")}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] transition",
              activeTab === "agent"
                ? "bg-white/[0.12] font-medium text-pure-white"
                : "text-white/65 hover:bg-white/[0.06] hover:text-pure-white",
            )}
          >
            <Bot className="size-4 shrink-0 text-white/60" />
            <span>Agent</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange("timeline")}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] transition",
              activeTab === "timeline"
                ? "bg-white/[0.12] font-medium text-pure-white"
                : "text-white/65 hover:bg-white/[0.06] hover:text-pure-white",
            )}
          >
            <CalendarDays className="size-4 shrink-0 text-white/60" />
            <span>Timeline</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange("collections")}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] transition",
              activeTab === "collections"
                ? "bg-white/[0.12] font-medium text-pure-white"
                : "text-white/65 hover:bg-white/[0.06] hover:text-pure-white",
            )}
          >
            <Layers className="size-4 shrink-0 text-white/60" />
            <span>Collections</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange("lms")}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] transition",
              activeTab === "lms"
                ? "bg-white/[0.12] font-medium text-pure-white"
                : "text-white/65 hover:bg-white/[0.06] hover:text-pure-white",
            )}
          >
            <BookOpen className="size-4 shrink-0 text-white/60" />
            <span>Artifacts</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange("analytics")}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] transition",
              activeTab === "analytics"
                ? "bg-white/[0.12] font-medium text-pure-white"
                : "text-white/65 hover:bg-white/[0.06] hover:text-pure-white",
            )}
          >
            <BarChart3 className="size-4 shrink-0 text-white/60" />
            <span>Analytics</span>
          </button>
        </div>
      </div>

      {/* Bottom User Profile Section */}
      <div className="relative shrink-0 border-t border-white/10 p-2">
        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg p-1.5 transition hover:bg-white/[0.08]",
            profileOpen && "bg-white/[0.08]",
          )}
        >
          {/* Avatar */}
          <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-graphite ring-1 ring-white/15">
            {avatarUrl && !imgError ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="size-full rounded-full object-cover"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
              />
            ) : (
              <span className="flex size-full items-center justify-center font-mono text-[10.5px] font-bold text-pure-white">
                {initial}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 text-left">
            <span className="truncate text-[12.5px] font-medium text-pure-white">
              {displayName}
            </span>
          </div>
          <ChevronDown className="size-3.5 text-white/40" />
        </button>

        {/* Profile Popover Menu */}
        {profileOpen ? (
          <Card className="shadow-key absolute bottom-full left-2 z-[999] mb-2 w-64 gap-3 border border-white/10 bg-[#0d0e12]/95 p-3.5 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-graphite ring-1 ring-white/10">
                {avatarUrl && !imgError ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="size-full rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="font-mono text-xs font-bold text-pure-white">
                    {initial}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-pure-white">
                  {displayName}
                </p>
                <p className="truncate font-mono text-[10.5px] text-smoke">
                  {accountLabel}
                </p>
              </div>
            </div>
            <Separator className="bg-white/10" />
            <div className="flex items-center justify-between font-mono text-[11px] text-white/40">
              <span>Vox Desktop</span>
              <span>v{__APP_VERSION__}</span>
            </div>
            <Button
              variant="destructive"
              className="h-8 w-full text-coral-pulse hover:bg-coral-pulse/15"
              onClick={() => {
                setProfileOpen(false);
                onSignOut();
              }}
            >
              Sign Out
            </Button>
          </Card>
        ) : null}
      </div>
    </aside>
  );
}
