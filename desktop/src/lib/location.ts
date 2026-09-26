import { invoke } from "@tauri-apps/api/core";

export type DeviceLocation = {
  lat: number;
  lng: number;
  source: "gps" | "ip" | "default";
  label: string;
  permissionDenied: boolean;
};

const DEFAULT_LOCATION: DeviceLocation = {
  lat: 13.0827,
  lng: 80.2707,
  source: "default",
  label: "Location unavailable — showing default",
  permissionDenied: false,
};

// WKWebView doesn't bridge navigator.geolocation to CoreLocation, and
// tauri-plugin-geolocation is a no-op on desktop. The native command calls
// CLLocationManager directly, which shows the system prompt and adds Vox
// to Location Services.
async function gpsOnce(): Promise<{ lat: number; lng: number }> {
  try {
    return await invoke<{ lat: number; lng: number }>("get_native_location");
  } catch (err) {
    const denied = err === "denied";
    throw Object.assign(new Error(String(err)), { code: denied ? 1 : 2 });
  }
}

async function ipApprox(): Promise<{ lat: number; lng: number; city?: string }> {
  const res = await fetch("https://ipapi.co/json/", {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error("IP lookup failed");
  const data = (await res.json()) as {
    latitude?: number;
    longitude?: number;
    city?: string;
    error?: boolean;
  };
  if (data.error || data.latitude == null || data.longitude == null) {
    throw new Error("IP lookup empty");
  }
  return {
    lat: data.latitude,
    lng: data.longitude,
    city: data.city,
  };
}

/** Prefer GPS; fall back to IP approx so the map still centers near the user. */
export async function resolveDeviceLocation(): Promise<DeviceLocation> {
  let permissionDenied = false;

  try {
    const gps = await gpsOnce();
    return {
      lat: gps.lat,
      lng: gps.lng,
      source: "gps",
      label: "You are here",
      permissionDenied: false,
    };
  } catch (err) {
    permissionDenied =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: number }).code === 1;
  }

  try {
    const ip = await ipApprox();
    return {
      lat: ip.lat,
      lng: ip.lng,
      source: "ip",
      label: ip.city ? `Approx · ${ip.city}` : "Approx from network",
      permissionDenied,
    };
  } catch {
    return { ...DEFAULT_LOCATION, permissionDenied };
  }
}
