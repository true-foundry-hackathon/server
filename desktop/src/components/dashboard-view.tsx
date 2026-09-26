import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { HomeRail, type HomeRailId } from "@/components/home-rail";
import { Button } from "@/components/ui/button";
import { VoxLogo, type VoxOrbVisualState } from "@/components/vox-logo";
import { resolveDeviceLocation } from "@/lib/location";
import { openLocationSettings } from "@/lib/tauri";
import { maplibregl, workerReady } from "@/lib/maplibre";
import { cn } from "@/lib/utils";

const FALLBACK = { lng: 80.2707, lat: 13.0827 };
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const BUILDINGS_LAYER = "vox-3d-buildings";
const HIGHLIGHT_SOURCE = "vox-highlight-source";
const HIGHLIGHT_LAYER = "vox-highlight-layer";
const ORBIT_DEG_PER_SEC = 4; // ~90s per revolution
const VIEW_PAD_DEG = 0.01; // ~1.1km box — keeps pan near home
const POS_CACHE_KEY = "vox-map-pos";

type ZoomMode = "city" | "district" | "street";

const ZOOM: Record<ZoomMode, { zoom: number; pitch: number; label: string }> = {
  city: { zoom: 15.8, pitch: 55, label: "City" },
  district: { zoom: 16.6, pitch: 58, label: "District" },
  street: { zoom: 17.5, pitch: 62, label: "Street" },
};


function mapsApiKey(): string {
  return (
    (import.meta.env.GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ||
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ||
    (import.meta.env.VOX_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ||
    ""
  );
}

function findBuildingSource(map: maplibregl.Map): string | null {
  const style = map.getStyle();
  if (!style?.sources) return null;
  for (const [id, source] of Object.entries(style.sources)) {
    if ((source as { type?: string }).type !== "vector") continue;
    if (id.includes("openmaptiles") || id.includes("protomaps") || id === "composite") {
      return id;
    }
  }
  const vector = Object.entries(style.sources).find(
    ([, s]) => (s as { type?: string }).type === "vector",
  );
  return vector?.[0] ?? null;
}

function ensureMissionControlLook(map: maplibregl.Map) {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", "#0b0c0e");
      }
      if (id.includes("water") && layer.type === "fill") {
        map.setPaintProperty(layer.id, "fill-color", "#060708");
      }
      if (
        (id.includes("land") || id.includes("landcover") || id.includes("landuse")) &&
        layer.type === "fill"
      ) {
        map.setPaintProperty(layer.id, "fill-color", "#121316");
      }
      if (
        (id.includes("road") ||
          id.includes("street") ||
          id.includes("path") ||
          id.includes("bridge") ||
          id.includes("tunnel")) &&
        layer.type === "line"
      ) {
        map.setPaintProperty(layer.id, "line-color", "#d0d1d2");
        map.setPaintProperty(layer.id, "line-opacity", 0.75);
      }
      // Hide flat 2D building fills AND any base-style extrusions — they
      // z-fight with our custom vox-3d-buildings layer during camera movement.
      if (id.includes("building") && (layer.type === "fill" || layer.type === "line" || layer.type === "fill-extrusion")) {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    } catch {
      /* style property may not apply to this layer */
    }
  }
}

// Insert 3D layers above all road/rail lines (otherwise flat lines paint over
// the extrusions) but below the first label that follows them.
function extrusionBeforeId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  let lastLine = -1;
  layers.forEach((l, i) => {
    if (l.type === "line") lastLine = i;
  });
  return layers.slice(lastLine + 1).find((l) => l.type === "symbol")?.id;
}

function ensure3dBuildings(map: maplibregl.Map) {
  if (map.getLayer(BUILDINGS_LAYER)) return;
  const sourceId = findBuildingSource(map);
  if (!sourceId) return;

  const beforeId = extrusionBeforeId(map);

  map.addLayer(
    {
      id: BUILDINGS_LAYER,
      source: sourceId,
      "source-layer": "building",
      type: "fill-extrusion",
      minzoom: 14,
      paint: {
        "fill-extrusion-color": "#6e6f72",
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          0,
          14.2,
          ["coalesce", ["get", "render_height"], ["get", "height"], 12],
        ],
        "fill-extrusion-base": [
          "coalesce",
          ["get", "render_min_height"],
          ["get", "min_height"],
          0,
        ],
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": false,
      },
    },
    beforeId,
  );
}

function ensureHighlightLayer(map: maplibregl.Map) {
  if (!map.getSource(HIGHLIGHT_SOURCE)) {
    map.addSource(HIGHLIGHT_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (map.getLayer(HIGHLIGHT_LAYER)) return;
  const beforeId = extrusionBeforeId(map);
  map.addLayer(
    {
      id: HIGHLIGHT_LAYER,
      source: HIGHLIGHT_SOURCE,
      type: "fill-extrusion",
      paint: {
        "fill-extrusion-color": "#ff3b30",
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          0,
          14.2,
          ["coalesce", ["get", "render_height"], ["get", "height"], 12],
        ],
        "fill-extrusion-base": [
          "coalesce",
          ["get", "render_min_height"],
          ["get", "min_height"],
          0,
        ],
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": false,
      },
    },
    beforeId,
  );
}

function outerRings(g: GeoJSON.Geometry | undefined): number[][][] {
  if (g?.type === "Polygon") return [g.coordinates[0]];
  if (g?.type === "MultiPolygon") return g.coordinates.map((p) => p[0]);
  return [];
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function highlightBuildingAt(
  map: maplibregl.Map,
  lng: number,
  lat: number,
): boolean {
  if (!map.getLayer(BUILDINGS_LAYER)) return false;
  ensureHighlightLayer(map);

  // GPS is often a few metres off (lands on the road), so search a wide box
  // and take the building containing the point, else the nearest one.
  const point = map.project([lng, lat]);
  const hits = map.queryRenderedFeatures(
    [
      [point.x - 80, point.y - 80],
      [point.x + 80, point.y + 80],
    ],
    { layers: [BUILDINGS_LAYER] },
  );
  if (hits.length === 0) {
    console.debug("[vox] highlightBuildingAt: no building features rendered near point", { lng, lat, point });
  }
  // Tiles merge same-height buildings into one MultiPolygon, so pick the
  // single ring (one building), not the whole feature.
  let building: maplibregl.MapGeoJSONFeature | null = null;
  let buildingRing: number[][] | null = null;
  let best = Infinity;
  for (const f of hits) {
    for (const ring of outerRings(f.geometry)) {
      const d = pointInRing(lng, lat, ring)
        ? -1
        : Math.min(...ring.map(([x, y]) => (x - lng) ** 2 + (y - lat) ** 2));
      if (d < best) {
        best = d;
        building = f;
        buildingRing = ring;
      }
    }
  }

  const src = map.getSource(HIGHLIGHT_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!building || !buildingRing) {
    src?.setData({ type: "FeatureCollection", features: [] });
    return false;
  }

  // Same footprint + height as the grey extrusion z-fights and grey often
  // wins, so grow the red copy ~3% and lift it 1m to fully cover it.
  const props = building.properties ?? {};
  const h = Number(props.render_height ?? props.height ?? 12) + 1;
  src?.setData({
    type: "FeatureCollection",
    features: [buildingRing].map((ring) => {
      const cx = ring.reduce((a, [x]) => a + x, 0) / ring.length;
      const cy = ring.reduce((a, [, y]) => a + y, 0) / ring.length;
      return {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [ring.map(([x, y]) => [cx + (x - cx) * 1.03, cy + (y - cy) * 1.03])],
        },
        properties: { ...props, render_height: h, height: h },
      };
    }),
  });
  return true;
}

function setHomeBounds(map: maplibregl.Map, lng: number, lat: number) {
  map.setMaxBounds([
    [lng - VIEW_PAD_DEG, lat - VIEW_PAD_DEG],
    [lng + VIEW_PAD_DEG, lat + VIEW_PAD_DEG],
  ]);
  map.setMinZoom(15.6);
  map.setMaxZoom(18);
}

function setUserPoint(_map: maplibregl.Map, _lng: number, _lat: number) {
  // Marker element is the only “YOU” affordance (matches reference HUD).
}

async function resolveNearbyPlace(
  lat: number,
  lng: number,
): Promise<{ name: string; id: string } | null> {
  const key = mapsApiKey();
  if (!key) return null;
  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchNearby",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.location,places.types",
        },
        body: JSON.stringify({
          maxResultCount: 5,
          rankPreference: "DISTANCE",
          includedTypes: ["premise", "point_of_interest", "establishment"],
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: 60,
            },
          },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        types?: string[];
      }>;
    };
    const places = data.places ?? [];
    const place =
      places.find((p) => p.types?.includes("premise")) ??
      places.find((p) => p.types?.includes("point_of_interest")) ??
      places[0];
    if (!place) return null;
    const name =
      place.displayName?.text?.trim() ||
      place.types?.[0]?.replace(/_/g, " ") ||
      "Nearby place";
    const shortId = (place.id ?? "LOC").replace(/^places\//, "").slice(-8).toUpperCase();
    return { name, id: shortId };
  } catch {
    return null;
  }
}

export function DashboardView({
  orbState,
  orbSpeed,
  isActive,
  isSpeaking,
  callState,
  label,
  subLabel,
  callError,
  pendingCount,
  onToggleCall,
  onOpenTasks,
  onOpenProjects,
  onOpenSettings,
}: {
  orbState: VoxOrbVisualState;
  orbSpeed: number;
  isActive: boolean;
  isSpeaking: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  pendingCount: number;
  onToggleCall: () => void;
  onOpenTasks: () => void;
  onOpenProjects: () => void;
  onOpenSettings: () => void;
}) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const userLngLat = useRef<[number, number] | null>(null);
  const [railActive, setRailActive] = useState<HomeRailId | null>(null);
  const [, setZoomMode] = useState<ZoomMode>("street");
  const [, setLocationNote] = useState("Locating…");
  const [, setPlaceTag] = useState<string | null>(null);
  const [locationSource, setLocationSource] = useState<
    "gps" | "ip" | "default" | null
  >(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [locPromptDismissed, setLocPromptDismissed] = useState(false);
  const relocateRef = useRef<(() => void) | null>(null);
  const orbitRaf = useRef<number | null>(null);
  const orbitPausedUntil = useRef(0);
  const orbitLastTs = useRef(0);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;

    // Worker blob must be set before creating the Map instance.
    void workerReady.then(() => init());

    function init() {
    if (!mapNode.current || mapRef.current) return;

    const container = mapNode.current;

    type CachedPos = { lng: number; lat: number };
    let cachedPos: CachedPos | null = null;
    try {
      cachedPos = JSON.parse(localStorage.getItem(POS_CACHE_KEY) ?? "null") as CachedPos | null;
    } catch { /* ignore */ }
    const initialCenter: [number, number] = cachedPos
      ? [cachedPos.lng, cachedPos.lat]
      : [FALLBACK.lng, FALLBACK.lat];

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: initialCenter,
      zoom: ZOOM.street.zoom,
      pitch: ZOOM.street.pitch,
      bearing: -28,
      attributionControl: false,
      maxPitch: 70,
      minPitch: 45,
      // Helps WebGL composite correctly over Tauri's transparent window.
      canvasContextAttributes: { alpha: false, antialias: true },
    } as maplibregl.MapOptions);
    mapRef.current = map;
    setHomeBounds(map, cachedPos?.lng ?? FALLBACK.lng, cachedPos?.lat ?? FALLBACK.lat);

    const el = document.createElement("div");
    el.className = "vox-hud-marker";
    el.style.visibility = "hidden";
    el.innerHTML = `
      <div class="vox-hud-marker__pin"></div>
      <div class="vox-hud-marker__stem"></div>
    `;
    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat(initialCenter)
      .addTo(map);
    markerRef.current = marker;

    const resize = () => {
      try {
        map.resize();
      } catch {
        /* map may be removed */
      }
    };

    // A live window drag can fire the observer dozens of times per second;
    // resizing the WebGL canvas on every tick is what causes the flicker on
    // this transparent, undecorated window. Coalesce to once per frame.
    let resizeRaf: number | null = null;
    const scheduleResize = () => {
      if (resizeRaf != null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        resize();
      });
    };

    const ro = new ResizeObserver(() => scheduleResize());
    ro.observe(container);

    const pauseOrbit = (ms = 4500) => {
      orbitPausedUntil.current = performance.now() + ms;
    };

    // Our own setBearing fires rotatestart too; only pause for real input.
    const onUserGesture = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) pauseOrbit();
    };
    map.on("dragstart", onUserGesture);
    map.on("zoomstart", onUserGesture);
    map.on("pitchstart", onUserGesture);
    map.on("rotatestart", onUserGesture);

    const stopOrbit = () => {
      if (orbitRaf.current != null) {
        cancelAnimationFrame(orbitRaf.current);
        orbitRaf.current = null;
      }
    };

    const startOrbit = () => {
      stopOrbit();
      orbitLastTs.current = performance.now();
      let orbitSpeed = 0;
      const frame = (now: number) => {
        const last = orbitLastTs.current || now;
        const dt = Math.min(0.05, (now - last) / 1000);
        orbitLastTs.current = now;
        const running = now >= orbitPausedUntil.current && !map.isMoving();
        // Ease speed in/out so resuming after a gesture feels like a camera dolly.
        orbitSpeed += ((running ? 1 : 0) - orbitSpeed) * Math.min(1, dt * 0.8);
        const center = userLngLat.current;
        if (center && orbitSpeed > 0.001 && !map.isMoving()) {
          try {
            // Keep locked on home while circling it.
            map.jumpTo({
              center,
              bearing: map.getBearing() + ORBIT_DEG_PER_SEC * orbitSpeed * dt,
            });
          } catch {
            /* ignore */
          }
        }
        orbitRaf.current = requestAnimationFrame(frame);
      };
      orbitRaf.current = requestAnimationFrame(frame);
    };

    const applyPosition = async (
      lng: number,
      lat: number,
      note: string,
      resolvePlace: boolean,
    ) => {
      userLngLat.current = [lng, lat];
      setLocationNote(note);
      marker.setLngLat([lng, lat]);
      el.style.visibility = "visible";
      try { localStorage.setItem(POS_CACHE_KEY, JSON.stringify({ lng, lat })); } catch { /* ignore */ }
      setUserPoint(map, lng, lat);
      setHomeBounds(map, lng, lat);
      resize();

      const mode = ZOOM.street;
      setZoomMode("street");
      pauseOrbit(2200);
      map.easeTo({
        center: [lng, lat],
        zoom: mode.zoom,
        pitch: mode.pitch,
        bearing: map.getBearing(),
        duration: 1800,
      });

      const paintHighlight = () => {
        highlightBuildingAt(map, lng, lat);
      };
      map.once("moveend", paintHighlight);
      map.once("idle", paintHighlight);
      window.setTimeout(paintHighlight, 800);
      window.setTimeout(paintHighlight, 1800);
      window.setTimeout(paintHighlight, 3200);

      if (!resolvePlace) {
        setPlaceTag(null);
        return;
      }

      const nearby = await resolveNearbyPlace(lat, lng);
      if (nearby) {
        setLocationNote(nearby.name);
        setPlaceTag(`VOX-${nearby.id}`);
      } else {
        setPlaceTag(null);
      }
    };

    const runLocate = async () => {
      setLocationNote("Locating…");
      const loc = await resolveDeviceLocation();
      setLocationSource(loc.source);
      setPermissionDenied(loc.permissionDenied);
      await applyPosition(loc.lng, loc.lat, loc.label, loc.source === "gps");
    };

    map.on("load", () => {
      ensureMissionControlLook(map);
      ensure3dBuildings(map);
      resize();
      window.setTimeout(resize, 100);
      window.setTimeout(resize, 500);
      setMapReady(true);
      startOrbit();
      void runLocate();
      relocateRef.current = () => {
        void runLocate();
      };
    });

    map.on("error", (e: { error?: { message?: string } }) => {
      const msg = e.error?.message ?? "Map failed to load";
      if (/worker/i.test(msg) || /failed to fetch|load/i.test(msg)) {
        setMapError(msg);
      }
    });

    return () => {
      stopOrbit();
      ro.disconnect();
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      map.off("dragstart", onUserGesture);
      map.off("zoomstart", onUserGesture);
      map.off("pitchstart", onUserGesture);
      map.off("rotatestart", onUserGesture);
      marker.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    } // end init
  }, []);

  function handleRailSelect(id: HomeRailId) {
    if (id === "tasks") {
      setRailActive(null);
      onOpenTasks();
      return;
    }
    if (id === "projects") {
      setRailActive(null);
      onOpenProjects();
      return;
    }
    if (id === "settings") {
      setRailActive("settings");
      onOpenSettings();
      return;
    }
    if (id === "voice") {
      setRailActive((prev) => (prev === "voice" ? null : "voice"));
      return;
    }
    setRailActive((prev) => (prev === id ? null : id));
  }

  const showVoiceHud =
    railActive === "voice" || isActive || callState === "connecting";
  const placeholder =
    railActive === "lms"
      ? "LMS — whiteboards, notes, and collections coming soon"
      : railActive === "data"
        ? "Data — finance, travel, and process history coming soon"
        : railActive === "analytics"
          ? "Analytics — live reports and graphs coming soon"
          : null;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#0b0c0e]">
      <div
        ref={mapNode}
        className="vox-map-host absolute inset-0"
        style={{ background: "#0b0c0e" }}
      />

      <div
        className="sign-in-glow pointer-events-none absolute -left-28 -top-32 z-[3] h-[30rem] w-[30rem] opacity-55"
        aria-hidden
      />
      <div
        className="sign-in-noise pointer-events-none absolute inset-0 z-[3]"
        aria-hidden
      />
      <div
        className="vox-map-noise pointer-events-none absolute inset-0 z-[3]"
        aria-hidden
      />
      <div
        className="vox-map-vignette pointer-events-none absolute inset-0 z-[3]"
        aria-hidden
      />

      {!mapReady && !mapError ? (
        <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
            Loading map…
          </p>
        </div>
      ) : null}

      {mapError ? (
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-void-black/85 px-8 text-center">
          <p className="max-w-md text-sm text-ash">{mapError}</p>
        </div>
      ) : null}

      <HomeRail
        active={railActive}
        pendingCount={pendingCount}
        onSelect={handleRailSelect}
      />

      {locationSource &&
      locationSource !== "gps" &&
      !locPromptDismissed ? (
        <div className="no-drag absolute bottom-6 left-[15.5rem] z-30 w-[22rem] rounded-md border border-white/20 bg-black/90 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
            Precise location
          </p>
          <p className="mt-2 text-[13px] leading-snug text-white/90">
            {permissionDenied
              ? "Location access was blocked. Open System Settings to enable it, then try again."
              : "We’re using an approximate city from your network. Enable Location for building-level accuracy."}
          </p>
          <div className="mt-4 flex gap-2">
            {permissionDenied && (
              <Button
                className="h-8 flex-1 rounded-md text-[12px]"
                onClick={() => void openLocationSettings()}
              >
                Open Settings
              </Button>
            )}
            <Button
              className="h-8 flex-1 rounded-md text-[12px]"
              onClick={() => relocateRef.current?.()}
            >
              Try again
            </Button>
            <Button
              variant="secondary"
              className="h-8 rounded-md text-[12px]"
              onClick={() => setLocPromptDismissed(true)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {placeholder ? (
        <div className="no-drag absolute bottom-6 left-[15.5rem] right-6 z-20 rounded-md border border-white/15 bg-black/80 px-4 py-3 font-mono text-[12px] text-white/70 backdrop-blur-md">
          {placeholder}
        </div>
      ) : null}

      {showVoiceHud ? (
        <div className="no-drag absolute bottom-6 right-6 z-20 flex w-[17rem] flex-col items-center gap-3 rounded-md border border-white/15 bg-black/90 p-4 backdrop-blur-md">
          <div
            className={cn(
              "flex items-center justify-center transition-transform",
              isSpeaking && "scale-105",
            )}
          >
            <VoxLogo
              size={96}
              animated
              state={orbState}
              speed={orbSpeed}
              theme="dark"
            />
          </div>
          <Button
            className={cn(
              "h-9 w-full gap-2 rounded-full",
              isActive
                ? "border border-coral-pulse/40 bg-ember-hush text-coral-pulse hover:bg-ember-hush/90"
                : "shadow-btn-lift",
            )}
            variant={isActive ? "destructive" : "default"}
            onClick={onToggleCall}
          >
            {isActive || callState === "connecting" ? (
              <MicOff className="size-3.5" />
            ) : (
              <Mic className="size-3.5" />
            )}
            {isActive
              ? "End call"
              : callState === "connecting"
                ? "Connecting…"
                : "Start talking"}
          </Button>
          <div className="text-center">
            <p className="text-[12px] text-ash">{label}</p>
            <p className="mt-0.5 text-[11px] text-smoke">{subLabel}</p>
            {callError ? (
              <p className="mt-2 text-[11px] text-coral-pulse">{callError}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
