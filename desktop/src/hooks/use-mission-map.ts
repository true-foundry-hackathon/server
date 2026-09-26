import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { resolveDeviceLocation } from "@/lib/location";
import { highlightBuildingAt } from "@/lib/map-highlight";
import { ensure3dBuildings, ensureMissionControlLook } from "@/lib/map-style";
import { maplibregl, workerReady } from "@/lib/maplibre";

const FALLBACK = { lng: 80.2707, lat: 13.0827 };
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const ORBIT_DEG_PER_SEC = 4; // ~90s per revolution
const VIEW_PAD_DEG = 0.01; // ~1.1km box — keeps pan near home
const POS_CACHE_KEY = "vox-map-pos";
const MAP_ZOOM = 16;
const MAP_PITCH = 62;

function setHomeBounds(map: maplibregl.Map, lng: number, lat: number) {
  map.setMaxBounds([
    [lng - VIEW_PAD_DEG, lat - VIEW_PAD_DEG],
    [lng + VIEW_PAD_DEG, lat + VIEW_PAD_DEG],
  ]);
  map.setMinZoom(15.6);
  map.setMaxZoom(18);
}

export type ResolvedLocation = {
  lat: number;
  lng: number;
  label: string;
  city?: string;
};

export function useMissionMap(): {
  mapNode: RefObject<HTMLDivElement | null>;
  mapReady: boolean;
  mapError: string;
  locationSource: "gps" | "ip" | "default" | null;
  location: ResolvedLocation | null;
  permissionDenied: boolean;
  relocate: () => void;
} {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const userLngLat = useRef<[number, number] | null>(null);
  const [locationSource, setLocationSource] = useState<
    "gps" | "ip" | "default" | null
  >(null);
  const [location, setLocation] = useState<ResolvedLocation | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
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
        cachedPos = JSON.parse(
          localStorage.getItem(POS_CACHE_KEY) ?? "null",
        ) as CachedPos | null;
      } catch {
        /* ignore */
      }
      const initialCenter: [number, number] = cachedPos
        ? [cachedPos.lng, cachedPos.lat]
        : [FALLBACK.lng, FALLBACK.lat];

      const map = new maplibregl.Map({
        container,
        style: STYLE_URL,
        center: initialCenter,
        zoom: MAP_ZOOM,
        pitch: MAP_PITCH,
        bearing: -28,
        attributionControl: false,
        maxPitch: 70,
        minPitch: 45,
        // Helps WebGL composite correctly over Tauri's transparent window.
        canvasContextAttributes: { alpha: false, antialias: true },
      } as maplibregl.MapOptions);
      mapRef.current = map;
      setHomeBounds(
        map,
        cachedPos?.lng ?? FALLBACK.lng,
        cachedPos?.lat ?? FALLBACK.lat,
      );

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
          orbitSpeed +=
            ((running ? 1 : 0) - orbitSpeed) * Math.min(1, dt * 0.8);
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

      const applyPosition = (lng: number, lat: number) => {
        userLngLat.current = [lng, lat];
        // Marker element is the only "YOU" affordance (matches reference HUD).
        marker.setLngLat([lng, lat]);
        el.style.visibility = "visible";
        try {
          localStorage.setItem(POS_CACHE_KEY, JSON.stringify({ lng, lat }));
        } catch {
          /* ignore */
        }
        setHomeBounds(map, lng, lat);
        resize();

        pauseOrbit(2200);
        map.easeTo({
          center: [lng, lat],
          zoom: MAP_ZOOM,
          pitch: MAP_PITCH,
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
      };

      const runLocate = async () => {
        const loc = await resolveDeviceLocation();
        setLocationSource(loc.source);
        setPermissionDenied(loc.permissionDenied);
        setLocation({
          lat: loc.lat,
          lng: loc.lng,
          label: loc.label,
          city: loc.city,
        });
        applyPosition(loc.lng, loc.lat);
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

  const relocate = useCallback(() => {
    relocateRef.current?.();
  }, []);

  return {
    mapNode,
    mapReady,
    mapError,
    locationSource,
    location,
    permissionDenied,
    relocate,
  };
}
