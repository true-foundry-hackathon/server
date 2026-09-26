import { useCallback, useEffect, useState } from "react";
import type { NewProjectForm } from "@/components/new-project-dialog";
import { api, invokeErrorMessage, type Collection } from "@/lib/tauri";

export function useProjects(signedIn: boolean) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [projectsError, setProjectsError] = useState("");

  const loadCollections = useCallback(async () => {
    try {
      const res = await api.getCollections();
      setCollections(res);
    } catch {
      /* keep previous list */
    }
  }, []);

  useEffect(() => {
    if (signedIn) void loadCollections();
  }, [signedIn, loadCollections]);

  async function createProject(form: NewProjectForm) {
    try {
      await api.createCollection({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        kind: form.kind,
      });
      setProjectsError("");
      await loadCollections();
    } catch (err) {
      setProjectsError(invokeErrorMessage(err));
      throw err;
    }
  }

  async function archiveProject(id: string) {
    try {
      await api.archiveCollection(id);
      if (selectedProjectId === id) setSelectedProjectId(null);
      setProjectsError("");
      await loadCollections();
    } catch (err) {
      setProjectsError(invokeErrorMessage(err));
    }
  }

  return {
    collections,
    selectedProjectId,
    setSelectedProjectId,
    projectsError,
    loadCollections,
    createProject,
    archiveProject,
  };
}
