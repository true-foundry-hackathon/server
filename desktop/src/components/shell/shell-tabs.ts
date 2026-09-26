import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  BookOpen,
  Database,
  FolderKanban,
  Home,
  ListTodo,
} from "lucide-react";

export type ShellTab =
  | "home"
  | "agent"
  | "tasks"
  | "projects"
  | "lms"
  | "data"
  | "analytics";

export const SHELL_TABS: { id: ShellTab; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "lms", label: "LMS", icon: BookOpen },
  { id: "data", label: "Data", icon: Database },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];
