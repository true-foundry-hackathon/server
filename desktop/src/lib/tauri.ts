import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type AuthState = {
  signed_in: boolean;
  user_id: string | null;
  email: string | null;
  bridge_url: string;
  api_url: string;
  has_phone: boolean;
  user_name?: string | null;
  avatar_url?: string | null;
};

export type CallStatus = {
  active: boolean;
  state: string;
  mic_level: number;
  is_speaking: boolean;
};

export type DeviceLinkStatus = {
  status: "connected" | "connecting" | "disconnected" | "disabled";
};

export type LocalEvent = {
  id: string;
  timestamp: string;
  kind: "system" | "command" | "output" | "status" | "success" | "error";
  text: string;
};

export type DesktopTask = {
  id: string;
  title: string;
  instruction: string;
  status: string;
  execution_type: string;
  project_name?: string | null;
  collection_id?: string | null;
  feasibility_reasoning?: string | null;
  execution_result?: unknown;
  due_at?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
};

export type PaginatedTasks = {
  items: DesktopTask[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

export type GetTasksArgs = {
  page?: number;
  page_size?: number;
  status?: string;
  search?: string;
  collection_id?: string;
};

export type CreateTaskPayload = {
  title: string;
  instruction?: string;
  execution_type?: string;
  project_name?: string;
  collection_id?: string;
  due_at?: string;
};

export type Collection = {
  id: string;
  name: string;
  description: string;
  kind: string;
  status: string;
};

export type CreateCollectionPayload = {
  name: string;
  description?: string;
  kind?: string;
};

export type UpdateTaskPayload = {
  task_id: string;
  status?: string;
  feasibility_reasoning?: string;
  execution_result?: unknown;
};

export const api = {
  getAuthState: () => invoke<AuthState>("get_auth_state"),
  signInWithGoogle: () => invoke<AuthState>("sign_in_with_google"),
  signOut: () => invoke<AuthState>("sign_out"),
  linkPhone: (phoneNumber: string) =>
    invoke<AuthState>("link_phone", { phoneNumber }),
  setWindowSize: (width: number, height: number) =>
    invoke("set_window_size", { width, height }),
  centerWindow: () => invoke("center_window"),
  getTasks: (args?: GetTasksArgs) =>
    invoke<PaginatedTasks>("get_tasks", { args: args ?? null }),
  createTask: (payload: CreateTaskPayload) =>
    invoke<DesktopTask>("create_task", { payload }),
  updateTask: (payload: UpdateTaskPayload) =>
    invoke<DesktopTask>("update_task", { payload }),
  startCall: () => invoke<CallStatus>("start_call"),
  endCall: () => invoke<CallStatus>("end_call"),
  callStatus: () => invoke<CallStatus>("call_status"),
  getCollections: () => invoke<Collection[]>("get_collections"),
  createCollection: (payload: CreateCollectionPayload) =>
    invoke<Collection>("create_collection", payload),
  archiveCollection: (id: string) => invoke<void>("archive_collection", { id }),
  deviceLinkStatus: () =>
    invoke<DeviceLinkStatus>("get_device_link_status"),
  setRemoteControl: (enabled: boolean) =>
    invoke<boolean>("set_remote_control", { enabled }),
  getLocalEvents: () => invoke<LocalEvent[]>("get_local_events"),
};

export const windowControls = {
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
};

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Eases the native window to a target logical size instead of snapping to it. */
export async function animateWindowSize(
  targetWidth: number,
  targetHeight: number,
  duration = 320,
): Promise<void> {
  const win = getCurrentWindow();
  const factor = await win.scaleFactor();
  const current = (await win.innerSize()).toLogical(factor);
  const fromW = current.width;
  const fromH = current.height;
  if (Math.abs(fromW - targetWidth) < 1 && Math.abs(fromH - targetHeight) < 1) {
    return;
  }

  const start = performance.now();
  await new Promise<void>((resolve) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      void api.setWindowSize(
        fromW + (targetWidth - fromW) * eased,
        fromH + (targetHeight - fromH) * eased,
      );
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Opens the OS location-privacy settings pane directly. */
export async function openLocationSettings(): Promise<void> {
  const isMac = navigator.userAgent.includes("Mac");
  const isWin = navigator.userAgent.includes("Win");
  const url = isMac
    ? "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices"
    : isWin
      ? "ms-settings:privacy-location"
      : "";
  if (url) await openUrl(url);
}

export function invokeErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Something went wrong";
}
