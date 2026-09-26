import { useEffect, useState } from "react";
import { api, type DeviceLinkStatus } from "@/lib/tauri";

const POLL_MS = 3000;

/** Live status of the desktop's socket to Vox Core, i.e. whether the Vox
 * agent on the server currently has a channel to control this machine. */
export function useDeviceLink(): DeviceLinkStatus["status"] {
  const [status, setStatus] =
    useState<DeviceLinkStatus["status"]>("disconnected");

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void api
        .deviceLinkStatus()
        .then((next) => {
          if (!cancelled) setStatus(next.status);
        })
        .catch(() => undefined);
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return status;
}
