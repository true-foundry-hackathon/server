import type { maplibregl } from "@/lib/maplibre";
import { BUILDINGS_LAYER, extrusionBeforeId } from "@/lib/map-style";

export const HIGHLIGHT_SOURCE = "vox-highlight-source";
export const HIGHLIGHT_LAYER = "vox-highlight-layer";

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

export function outerRings(g: GeoJSON.Geometry | undefined): number[][][] {
  if (g?.type === "Polygon") return [g.coordinates[0]];
  if (g?.type === "MultiPolygon") return g.coordinates.map((p) => p[0]);
  return [];
}

export function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function highlightBuildingAt(
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

  const src = map.getSource(HIGHLIGHT_SOURCE) as
    maplibregl.GeoJSONSource | undefined;
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
          coordinates: [
            ring.map(([x, y]) => [cx + (x - cx) * 1.03, cy + (y - cy) * 1.03]),
          ],
        },
        properties: { ...props, render_height: h, height: h },
      };
    }),
  });
  return true;
}
