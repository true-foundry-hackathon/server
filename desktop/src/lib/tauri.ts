import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type AuthState = {
  signed_in: boolean;
  user_id: string | null;
  email: string | null;
  bridge_url: string;
  api_url: string;
};

export type CallStatus = {
  active: boolean;
  state: string;
  mic_level: number;
  is_speaking: boolean;
};

export type DesktopTask = {
  id: string;
  title: string;
  instruction: string;
  status: string;
  execution_type: string;
  project_name?: string | null;
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
};

export type CreateTaskPayload = {
  title: string;
  instruction?: string;
  execution_type?: string;
  project_name?: string;
  due_at?: string;
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
};

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
