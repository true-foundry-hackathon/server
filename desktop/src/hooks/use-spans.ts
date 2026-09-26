import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type Span, type SpanQuery } from "@/lib/tauri";

const POLL_INTERVAL_MS = 15_000;

export function useSpans(query: SpanQuery, enabled = true) {
  const [spans, setSpans] = useState<Span[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const key = JSON.stringify(query);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSpans(await api.getSpans(JSON.parse(key) as SpanQuery));
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    void listen<string>("vox-live-update", (event) => {
      try {
        const payload = JSON.parse(event.payload) as { type?: string };
        if (payload.type?.startsWith("span_")) void load();
      } catch {
        /* ignore malformed frame */
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [enabled, load]);

  return { spans, loading, error, reload: load };
}
