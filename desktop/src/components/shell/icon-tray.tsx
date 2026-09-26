import { SHELL_TABS, type ShellTab } from "@/components/shell/shell-tabs";
import { cn } from "@/lib/utils";

export function IconTray({
  activeTab,
  onTabChange,
  pendingCount,
}: {
  activeTab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  pendingCount: number;
}) {
  return (
    <nav className="relative flex w-16 shrink-0 flex-col items-center gap-1 py-4">
      {SHELL_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === activeTab;
        const badge =
          tab.id === "tasks" && pendingCount > 0 ? pendingCount : undefined;
        return (
          <button
            key={tab.id}
            type="button"
            title={tab.label}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "relative flex size-11 flex-col items-center justify-center gap-0.5 rounded-2xl text-ash transition",
              active
                ? "bg-graphite text-pure-white"
                : "hover:bg-obsidian hover:text-pure-white",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={1.75} />
            {badge != null ? (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral-pulse px-1 font-mono text-[9.5px] font-semibold text-white shadow-[0_0_6px_rgba(255,99,99,0.5)]">
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
