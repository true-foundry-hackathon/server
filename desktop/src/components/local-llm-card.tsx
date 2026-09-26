import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, type LocalLlmDownloadProgress } from "@/lib/tauri";

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

export function LocalLlmCard() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<LocalLlmDownloadProgress | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.isLocalLlmDownloaded().then(setReady).catch(() => setReady(false));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<LocalLlmDownloadProgress>("local-llm-download-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.done) {
        setDownloading(false);
        setReady(true);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  async function startDownload() {
    setDownloading(true);
    setError("");
    try {
      await api.downloadLocalLlm();
      setReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }

  if (ready === null) return null;

  const pct =
    progress?.total_bytes && progress.total_bytes > 0
      ? Math.min(100, Math.round((progress.downloaded_bytes / progress.total_bytes) * 100))
      : null;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-obsidian px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-smoke">
          Local processing
        </span>
        {ready ? (
          <Badge variant="default">Active — Gemma 2B on this device</Badge>
        ) : downloading ? (
          <Badge variant="secondary">
            Downloading{pct !== null ? ` ${pct}%` : "…"}
            {progress ? ` (${formatMb(progress.downloaded_bytes)})` : ""}
          </Badge>
        ) : (
          <Badge variant="secondary">Not enabled</Badge>
        )}
        {error && <span className="text-xs text-coral-pulse">{error}</span>}
      </div>
      {!ready && !downloading && (
        <Button size="sm" variant="outline" onClick={() => void startDownload()}>
          Download model (1.4 GB)
        </Button>
      )}
    </div>
  );
}
