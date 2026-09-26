import { useState } from "react";
import { Archive, PanelLeftClose, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NewProjectDialog,
  type NewProjectForm,
} from "@/components/new-project-dialog";
import { VoxLogo } from "@/components/vox-logo";
import type { Collection } from "@/lib/tauri";

const emptyNewProject: NewProjectForm = {
  name: "",
  description: "",
  kind: "project",
};

export function ProjectsView({
  collections,
  onSelectProject,
  onCreateProject,
  onArchiveProject,
  onCollapse,
}: {
  collections: Collection[];
  onSelectProject: (id: string) => void;
  onCreateProject: (form: NewProjectForm) => Promise<void>;
  onArchiveProject: (id: string) => void;
  onCollapse: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<NewProjectForm>(emptyNewProject);

  const active = collections.filter((c) => c.status !== "archived");

  async function handleSubmit() {
    if (!form.name.trim()) return;
    await onCreateProject(form);
    setForm(emptyNewProject);
    setShowNew(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-ink px-7 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
          <Badge variant="secondary" className="font-mono">
            {active.length} projects
          </Badge>
        </div>
        <div className="no-drag flex items-center gap-2.5">
          <Button size="sm" className="shadow-btn-lift gap-1.5" onClick={() => setShowNew(true)}>
            <Plus className="size-4" />
            New Project
          </Button>
          <Button
            variant="secondary"
            size="icon"
            title="Collapse to Dashboard (Esc)"
            onClick={onCollapse}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      </header>

      <div className="no-drag min-h-0 flex-1 overflow-auto px-7 py-6">
        {active.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <VoxLogo size={54} />
            <h3 className="text-lg font-medium">No projects yet</h3>
            <p className="max-w-sm text-sm text-ash">
              Create a project to group tasks, notes, and datasets together.
            </p>
            <Button className="shadow-btn-lift mt-2 gap-1.5" onClick={() => setShowNew(true)}>
              <Plus className="size-4" />
              New Project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectProject(c.id)}
                className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-obsidian p-4 text-left transition hover:border-electric-sky/50"
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-medium text-pure-white">{c.name}</span>
                  <Badge variant="outline">{c.kind}</Badge>
                </div>
                {c.description ? (
                  <p className="line-clamp-2 text-xs text-ash">{c.description}</p>
                ) : null}
                <div className="mt-auto flex w-full items-center justify-between pt-2">
                  <Badge variant="secondary">{c.status}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 transition group-hover:opacity-100"
                    title="Archive project"
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveProject(c.id);
                    }}
                  >
                    <Archive className="size-3.5" />
                  </Button>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <NewProjectDialog
        open={showNew}
        form={form}
        onOpenChange={setShowNew}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        onSubmit={() => void handleSubmit()}
      />
    </div>
  );
}
