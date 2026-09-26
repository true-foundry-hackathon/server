import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type TimelineEntry } from "@/lib/tauri";

const WINDOW_DAYS = 7;
const POLL_INTERVAL_MS = 3500;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function useTimeline() {
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const windowStart = useMemo(() => {
    const d = new Date(anchor);
    d.setDate(d.getDate() - Math.floor(WINDOW_DAYS / 2));
    return d;
  }, [anchor]);

  const windowEnd = useMemo(() => {
    const d = new Date(windowStart);
    d.setDate(d.getDate() + WINDOW_DAYS);
    return d;
  }, [windowStart]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getTimeline({
        from: windowStart.toISOString(),
        to: windowEnd.toISOString(),
      });
      setEntries(res ?? []);
    } catch {
      /* keep previous entries */
    } finally {
      setLoading(false);
    }
  }, [windowStart, windowEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const goToPreviousWindow = useCallback(() => {
    setAnchor((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - WINDOW_DAYS);
      return d;
    });
  }, []);

  const goToNextWindow = useCallback(() => {
    setAnchor((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + WINDOW_DAYS);
      return d;
    });
  }, []);

  const goToToday = useCallback(() => {
    setAnchor(startOfDay(new Date()));
  }, []);

  return {
    entries,
    loading,
    windowStart,
    windowEnd,
    goToPreviousWindow,
    goToNextWindow,
    goToToday,
  };
}
