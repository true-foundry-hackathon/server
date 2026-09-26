import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Database,
  ListTodo,
  Mic,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type HomeRailId =
  | "lms"
  | "tasks"
  | "voice"
  | "data"
  | "analytics"
  | "settings";

const ITEMS: {
  id: HomeRailId;
  label: string;
  hint: string;
  icon: LucideIcon;
  accent: string;
}[] = [
  {
    id: "lms",
    label: "LMS",
    hint: "Notes, whiteboards, collections",
    icon: BookOpen,
    accent: "hover:text-coral-pulse data-[active=true]:text-coral-pulse",
  },
  {
    id: "tasks",
    label: "Tasks",
    hint: "Your work and agent jobs",
    icon: ListTodo,
    accent: "hover:text-electric-sky data-[active=true]:text-electric-sky",
  },
  {
    id: "voice",
    label: "Voice",
    hint: "Talk to your agent",
    icon: Mic,
    accent: "hover:text-coral-pulse data-[active=true]:text-coral-pulse",
  },
  {
    id: "data",
    label: "Data",
    hint: "Finance, travel, history",
    icon: Database,
    accent: "hover:text-success-green data-[active=true]:text-success-green",
  },
  {
    id: "analytics",
    label: "Analytics",
    hint: "Spend, distance, usage",
    icon: BarChart3,
    accent: "hover:text-info-blue data-[active=true]:text-info-blue",
  },
  {
    id: "settings",
    label: "Settings",
    hint: "Account and session",
    icon: Settings,
    accent: "hover:text-mist data-[active=true]:text-mist",
  },
];

export function HomeRail({
  active,
  pendingCount,
  onSelect,
}: {
  active: HomeRailId | null;
  pendingCount: number;
  onSelect: (id: HomeRailId) => void;
}) {
  return (
    <nav
      className="no-drag absolute bottom-4 left-4 top-11 z-20 flex w-[13.5rem] flex-col overflow-hidden rounded-2xl border border-border-subtle/80 bg-ink/80 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
      aria-label="Home"
    >
      <div className="sign-in-noise pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative z-10 border-b border-border-subtle/70 px-3.5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-smoke">
          Command
        </p>
        <p className="mt-0.5 text-[13px] text-pure-white">Vox Desktop</p>
      </div>
      <ul className="relative z-10 flex flex-1 flex-col gap-0.5 p-2">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                data-active={isActive}
                title={item.hint}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                  "text-ash hover:bg-white/[0.04]",
                  isActive && "bg-white/[0.06]",
                  item.accent,
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg bg-obsidian text-current",
                    isActive && "bg-graphite",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-pure-white">
                      {item.label}
                    </span>
                    {item.id === "tasks" && pendingCount > 0 ? (
                      <span className="rounded-full bg-electric-sky/15 px-1.5 font-mono text-[9px] text-electric-sky">
                        {pendingCount}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[10.5px] text-smoke group-hover:text-ash">
                    {item.hint}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
