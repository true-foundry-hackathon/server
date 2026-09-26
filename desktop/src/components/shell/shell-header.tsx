import { ChevronDown, ChevronUp } from "lucide-react";
import { AccountMenu } from "@/components/shell/account-menu";
import { WidgetNoise } from "@/components/widget-illustrations";
import { windowControls } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { WIDGET_GLASS, WIDGET_RADIUS } from "@/lib/widget-style";

const CONTROLS = [
  { title: "Close", color: "#ff5f57", action: windowControls.close },
  { title: "Minimize", color: "#febc2e", action: windowControls.minimize },
  { title: "Fullscreen", color: "#28c840", action: windowControls.toggleMaximize },
] as const;

export function ShellHeader({
  collapsed,
  onToggleCollapsed,
  accountLabel,
  onSignOut,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  accountLabel: string;
  onSignOut: () => void;
}) {
  return (
    <div
      className={cn(
        "no-drag pointer-events-auto relative w-full overflow-hidden",
        WIDGET_GLASS,
        WIDGET_RADIUS,
      )}
    >
      <WidgetNoise />
      <div
        data-tauri-drag-region
        className="relative flex w-full items-center p-4"
      >
        <div className="flex items-center gap-1.5">
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
          <button
            type="button"
            title={collapsed ? "Expand" : "Collapse"}
            onClick={onToggleCollapsed}
            className="ml-1.5 flex size-4 items-center justify-center rounded-full text-white/50 transition hover:text-pure-white"
          >
            {collapsed ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronUp className="size-3.5" />
            )}
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center">
          <span className="text-[13px] font-medium text-pure-white">Vox</span>
          <span className="font-mono text-[9px] text-white/40">
            v{__APP_VERSION__}
          </span>
        </div>
        <AccountMenu accountLabel={accountLabel} onSignOut={onSignOut} />
      </div>
    </div>
  );
}
