import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import maplibreSharedUrl from "maplibre-gl/dist/maplibre-gl-shared.mjs?url";

// Tauri's tauri:// protocol can't spawn Web Workers directly.
// Fetch the script and re-serve it as a blob: URL so the WebView accepts it.
// The worker script imports a sibling chunk via a relative specifier
// ("./maplibre-gl-shared.mjs"), which can't resolve against an opaque
// blob: URL — rewrite it to the chunk's real, Vite-emitted URL first.
async function setWorkerBlob() {
  try {
    const res = await fetch(maplibreWorkerUrl);
    const text = await res.text();
    const sharedAbsoluteUrl = new URL(
      maplibreSharedUrl,
      location.href,
    ).toString();
    const patched = text.replace(
      '"./maplibre-gl-shared.mjs"',
      JSON.stringify(sharedAbsoluteUrl),
    );
    const blob = new Blob([patched], { type: "text/javascript" });
    maplibregl.setWorkerUrl(URL.createObjectURL(blob));
  } catch {
    // Fallback: try the direct URL (works in dev mode / standard browsers)
    maplibregl.setWorkerUrl(maplibreWorkerUrl);
  }
}

export const workerReady: Promise<void> = setWorkerBlob();

export { maplibregl };
