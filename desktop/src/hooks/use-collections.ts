import { useCallback, useEffect, useState } from "react";
import {
  api,
  invokeErrorMessage,
  type Collection,
  type NewCollection,
} from "@/lib/tauri";

export function useCollections(signedIn: boolean) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setCollections(await api.getCollections());
    } catch {
      /* keep previous list */
    }
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  async function create(form: NewCollection) {
    try {
      await api.createCollection(form);
      setError("");
      await load();
    } catch (err) {
      setError(invokeErrorMessage(err));
      throw err;
    }
  }

  async function archive(id: string) {
    try {
      await api.archiveCollection(id);
      if (selectedId === id) setSelectedId(null);
      setError("");
      await load();
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }

  return {
    collections,
    selectedId,
    setSelectedId,
    error,
    reload: load,
    create,
    archive,
  };
}
