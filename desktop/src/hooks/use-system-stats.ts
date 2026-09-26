import { useEffect, useState } from "react";
import { api, type SystemStats } from "@/lib/tauri";

const HISTORY_LIMIT = 30;
const POLL_MS = 2000;

export function useSystemStats() {
  const [history, setHistory] = useState<SystemStats[]>([]);

  useEffect(() => {
    let cancelled = false;
    const id = window.setInterval(() => {
      void api.getSystemStats().then((stats) => {
        if (cancelled) return;
        setHistory((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), stats]);
      });
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return history;
}
