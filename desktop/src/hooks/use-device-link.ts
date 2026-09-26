import { useCallback, useEffect, useState } from "react";
import { api, type DeviceLinkStatus } from "@/lib/tauri";

const POLL_MS = 3000;

/** Live status of the desktop's socket to Vox Core, i.e. whether the Vox
 * agent on the server currently has a channel to control this machine, plus
 * the user's opt-in toggle for that control ("disabled" = opted out). */
export function useDeviceLink(): {
  status: DeviceLinkStatus["status"];
  toggleRemoteControl: () => void;
} {
  const [status, setStatus] =
    useState<DeviceLinkStatus["status"]>("disconnected");

  const poll = useCallback(() => {
    void api
      .deviceLinkStatus()
      .then((next) => setStatus(next.status))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  const toggleRemoteControl = useCallback(() => {
    void api
      .setRemoteControl(status === "disabled")
      .then(poll)
      .catch(() => undefined);
  }, [status, poll]);

  return { status, toggleRemoteControl };
}
