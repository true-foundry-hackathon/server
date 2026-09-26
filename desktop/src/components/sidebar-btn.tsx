import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SidebarBtn({
  active,
  title,
  children,
  onClick,
  badge,
  round,
}: {
  active?: boolean;
  title: string;
  children: ReactNode;
  onClick: () => void;
  badge?: number;
  round?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "relative flex size-11 items-center justify-center border border-transparent text-ash transition",
        round ? "rounded-full bg-obsidian" : "rounded-md",
        active
          ? "shadow-key border-white/15 bg-graphite text-pure-white"
          : "hover:border-white/10 hover:bg-obsidian hover:text-pure-white",
      )}
    >
      {active && !round ? (
        <span className="absolute -left-2.5 top-2.5 bottom-2.5 w-0.5 rounded-r bg-coral-pulse shadow-[0_0_6px_rgba(255,99,99,0.5)]" />
      ) : null}
      {children}
      {badge != null ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral-pulse px-1 font-mono text-[10px] font-semibold text-white shadow-[0_0_6px_rgba(255,99,99,0.6)]">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
