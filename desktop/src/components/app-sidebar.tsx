import { Home, ListTodo, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CoralDiamond } from "@/components/icons";
import { SidebarBtn } from "@/components/sidebar-btn";

export type DesktopView = "dashboard" | "tasks";

export function AppSidebar({
  view,
  pendingCount,
  showProfile,
  accountLabel,
  onViewChange,
  onToggleProfile,
  onSignOut,
}: {
  view: DesktopView;
  pendingCount: number;
  showProfile: boolean;
  accountLabel: string;
  onViewChange: (view: DesktopView) => void;
  onToggleProfile: () => void;
  onSignOut: () => void;
}) {
  return (
    <aside className="flex w-16 shrink-0 flex-col items-center justify-between border-r border-border bg-ink pb-4 pt-11">
      <div className="flex w-full flex-col items-center gap-4">
        <button
          type="button"
          className="mb-2 flex size-[38px] items-center justify-center rounded-md transition hover:scale-105"
          onClick={() => onViewChange("dashboard")}
          title="Vox Cockpit"
        >
          <CoralDiamond />
        </button>
        <nav className="flex flex-col items-center gap-2">
          <SidebarBtn
            active={view === "dashboard"}
            title="Home"
            onClick={() => onViewChange("dashboard")}
          >
            <Home className="size-5" />
          </SidebarBtn>
          <SidebarBtn
            active={view === "tasks"}
            title="Tasks"
            badge={pendingCount > 0 ? pendingCount : undefined}
            onClick={() => onViewChange("tasks")}
          >
            <ListTodo className="size-5" />
          </SidebarBtn>
        </nav>
      </div>

      <div className="relative">
        <SidebarBtn
          active={showProfile}
          title="Account"
          round
          onClick={onToggleProfile}
        >
          <User className="size-5" />
        </SidebarBtn>
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
                <span className="text-mist">bridge.voxagent.in</span>
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
    </aside>
  );
}
