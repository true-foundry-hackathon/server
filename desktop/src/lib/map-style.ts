import type { maplibregl } from "@/lib/maplibre";

export const BUILDINGS_LAYER = "vox-3d-buildings";

export function findBuildingSource(map: maplibregl.Map): string | null {
  const style = map.getStyle();
  if (!style?.sources) return null;
  for (const [id, source] of Object.entries(style.sources)) {
    if ((source as { type?: string }).type !== "vector") continue;
    if (
      id.includes("openmaptiles") ||
      id.includes("protomaps") ||
      id === "composite"
    ) {
      return id;
    }
  }
  const vector = Object.entries(style.sources).find(
    ([, s]) => (s as { type?: string }).type === "vector",
  );
  return vector?.[0] ?? null;
}

export function ensureMissionControlLook(map: maplibregl.Map) {
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
        (id.includes("land") ||
          id.includes("landcover") ||
          id.includes("landuse")) &&
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
      if (
        id.includes("building") &&
        (layer.type === "fill" ||
          layer.type === "line" ||
          layer.type === "fill-extrusion")
      ) {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    } catch {
      /* style property may not apply to this layer */
    }
  }
}

// Insert 3D layers above all road/rail lines (otherwise flat lines paint over
// the extrusions) but below the first label that follows them.
export function extrusionBeforeId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  let lastLine = -1;
  layers.forEach((l, i) => {
    if (l.type === "line") lastLine = i;
  });
  return layers.slice(lastLine + 1).find((l) => l.type === "symbol")?.id;
}

export function ensure3dBuildings(map: maplibregl.Map) {
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
