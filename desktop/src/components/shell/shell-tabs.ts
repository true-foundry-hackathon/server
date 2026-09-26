import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  BookOpen,
  CalendarDays,
  Database,
  Home,
  Layers,
} from "lucide-react";

export type ShellTab =
  "home" | "agent" | "timeline" | "collections" | "lms" | "data" | "analytics";

export const SHELL_TABS: { id: ShellTab; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "timeline", label: "Timeline", icon: CalendarDays },
  { id: "collections", label: "Collections", icon: Layers },
  { id: "lms", label: "LMS", icon: BookOpen },
  { id: "data", label: "Data", icon: Database },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];
