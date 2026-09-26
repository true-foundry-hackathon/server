# Home Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bento/widget-grid home screen with a docked header+body app shell (icon-tray nav, Agent tab as default with the talk UI + a placeholder activity log), and add a new system resource monitor widget backed by real CPU/RAM/battery telemetry.

**Architecture:** A new `HomeShell` component (header + collapsible body with icon tray + tab content) replaces `DashboardView` as the app's permanent chrome, rendered once from `App.tsx` for every tab (not just a "dashboard" view). A new Tauri command (`get_system_stats`, backed by `sysinfo` + `starship-battery`) is polled from a new frontend hook to feed a small floating `SystemMonitorWidget`. The old bento grid (`dashboard-view.tsx`, `titlebar-widget.tsx`, `talk-to-vox-widget.tsx`, the grid math in `widget-style.ts`) is deleted.

**Tech Stack:** React + TypeScript (vox-desktop frontend), Rust + Tauri 2 (src-tauri), `sysinfo` and `starship-battery` crates (new), Tailwind CSS, lucide-react icons. No new frontend dependency — the system monitor's chart is hand-rolled inline SVG.

**Spec:** [docs/superpowers/specs/2026-09-25-home-shell-redesign-design.md](../specs/2026-09-25-home-shell-redesign-design.md)

## Global Constraints

- No tests. Do not create test files, `#[test]` modules, or ad hoc self-checks. Verification is: Rust tasks build with `cargo build`, frontend tasks pass `npx tsc -b --noEmit` and `npx eslint`, and the final integration task gets a manual browser walkthrough.
- No code comments. Skip explanatory comments in every file this plan creates or edits, including the Rust command and the JSX components.
- No new frontend npm dependency. The system monitor's graph is hand-rolled SVG polylines, not a charting library.
- New Rust dependencies are exactly `sysinfo = "0.39"` and `starship-battery = "0.11"` — nothing else.
- Reuse `WIDGET_GLASS`, `WIDGET_RADIUS` (from `src/lib/widget-style.ts`) and `WidgetNoise` (from `src/components/widget-illustrations.tsx`) for the header/body panel and the system monitor card — these are the deliberate holdovers from the retired widget system, per the spec.
- Agent is the default selected tab, not Home.
- Agent tab split is exactly 70% talk pane / 30% activity log pane.
- Icon tray sections, in order: Home, Agent, Tasks, Projects, LMS, Data, Analytics.
- Location and Desktop Link data/UI (from the old `StatWidget`) are dropped entirely, not relocated anywhere — including the location-permission-prompt banner that lived in the old `DashboardView`, since nothing will display location info anymore.

## Review Focus

- First system-stats poll right after launch: `sysinfo` needs a prior `refresh_cpu_usage()` call to compute an accurate delta, so the very first reading may look off — confirm it settles to a sane value by the second poll (~2s later), not just eyeball the first one.
- Machines/environments with no battery (e.g. a Mac without one, or `starship-battery` finding zero devices) must return `battery_percent: null` from the command, not fail the whole call.
- Switching tabs while a call is active must not affect `isActive`/`callState` — the call session lives in `App`, not per-tab; verify the mic stays live after tabbing away from Agent and back.
- Collapsing the body on a non-Agent tab (say Tasks), then expanding again, must land back on Tasks, not reset to Agent.
- Sign-out via the new `AccountMenu` must actually end the session and drop back to `SignInScreen` — this UI path had no entry point for several prior redesign passes in this app's history, so it's the most likely thing to be stale.

---

## File Structure

**New files:**
- `src-tauri/src/system_stats.rs` — `SystemStats` struct + `get_system_stats` Tauri command + `SystemStatsState`.
- `src/hooks/use-system-stats.ts` — polls `get_system_stats`, keeps a rolling history.
- `src/components/system-monitor-widget.tsx` — floating CPU/RAM/battery graph card.
- `src/components/shell/icon-tray.tsx` — `ShellTab` type, `SHELL_TABS` config, `IconTray` nav rail.
- `src/components/shell/account-menu.tsx` — avatar button + sign-out dropdown.
- `src/components/shell/shell-header.tsx` — window controls + collapse toggle + Vox/version + `AccountMenu`.
- `src/components/shell/agent-pane.tsx` — `AgentPane` (talk pane + activity log pane).
- `src/components/shell/placeholder-pane.tsx` — generic "coming soon" pane.
- `src/components/home-shell.tsx` — composes everything into the docked shell.

**Modified files:**
- `src-tauri/Cargo.toml` — add `sysinfo`, `starship-battery`.
- `src-tauri/src/lib.rs` — register `system_stats` module, state, command.
- `src/lib/tauri.ts` — add `SystemStats` type + `api.getSystemStats`.
- `src/lib/widget-style.ts` — drop the grid/cell exports, keep `WIDGET_GLASS`/`WIDGET_RADIUS`.
- `src/hooks/use-tasks.ts` — retype its `view` param from `DesktopView` to `ShellTab`.
- `src/app.tsx` — render `HomeShell` instead of `DashboardView` + titlebar pinning; own `activeTab` state; restore sign-out wiring.

**Deleted files:**
- `src/components/dashboard-view.tsx`
- `src/components/titlebar-widget.tsx`
- `src/components/talk-to-vox-widget.tsx`

---

### Task 1: System stats Tauri command

**Files:**
- Create: `src-tauri/src/system_stats.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `system_stats::SystemStatsState::new() -> SystemStatsState`, `#[tauri::command] system_stats::get_system_stats(state: State<'_, SystemStatsState>) -> SystemStats`, `SystemStats { cpu_percent: f32, ram_percent: f32, battery_percent: Option<f32> }` (all fields `Serialize`, so they reach the frontend as `cpu_percent`/`ram_percent`/`battery_percent`).

- [ ] **Step 1: Add the two new dependencies**

In `src-tauri/Cargo.toml`, under `[dependencies]` (after the existing `portable-pty = "0.9.0"` line), add:

```toml
sysinfo = "0.39"
starship-battery = "0.11"
```

- [ ] **Step 2: Write the command module**

Create `src-tauri/src/system_stats.rs`:

```rust
use serde::Serialize;
use starship_battery::units::ratio::percent;
use std::sync::Mutex;
use sysinfo::System;
use tauri::State;

pub struct SystemStatsState(Mutex<System>);

impl SystemStatsState {
    pub fn new() -> Self {
        Self(Mutex::new(System::new_all()))
    }
}

#[derive(Debug, Serialize)]
pub struct SystemStats {
    cpu_percent: f32,
    ram_percent: f32,
    battery_percent: Option<f32>,
}

fn read_battery_percent() -> Option<f32> {
    let manager = starship_battery::Manager::new().ok()?;
    let battery = manager.batteries().ok()?.next()?.ok()?;
    Some(battery.state_of_charge().get::<percent>())
}

#[tauri::command]
pub fn get_system_stats(state: State<'_, SystemStatsState>) -> SystemStats {
    let mut sys = state.0.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_percent = sys.global_cpu_usage();
    let ram_percent = if sys.total_memory() == 0 {
        0.0
    } else {
        (sys.used_memory() as f64 / sys.total_memory() as f64 * 100.0) as f32
    };

    SystemStats {
        cpu_percent,
        ram_percent,
        battery_percent: read_battery_percent(),
    }
}
```

- [ ] **Step 3: Register the module, state, and command**

In `src-tauri/src/lib.rs`:

Add to the `mod` list near the top (alphabetical, after `mod session_store;`):

```rust
mod system_stats;
```

Add near the other `use` lines:

```rust
use system_stats::SystemStatsState;
```

In the builder chain, next to the other `.manage(...)` calls (e.g. after `.manage(device_link::RemoteControl::load())`):

```rust
.manage(SystemStatsState::new())
```

In the `invoke_handler![...]` list, add:

```rust
system_stats::get_system_stats,
```

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build`
Expected: builds with no errors (warnings about `new_without_default` on `SystemStatsState`, if any, are fine to leave).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/system_stats.rs src-tauri/src/lib.rs
git commit -m "Add get_system_stats Tauri command"
```

---

### Task 2: Frontend system-stats types, API, and polling hook

**Files:**
- Modify: `src/lib/tauri.ts`
- Create: `src/hooks/use-system-stats.ts`

**Interfaces:**
- Consumes: Task 1's `get_system_stats` command name and response shape.
- Produces: `SystemStats` type (from `@/lib/tauri`), `api.getSystemStats(): Promise<SystemStats>`, `useSystemStats(): SystemStats[]` (from `@/hooks/use-system-stats`).

- [ ] **Step 1: Add the type and API call**

In `src/lib/tauri.ts`, add near the other types (after `export type DeviceLinkStatus = {...};`):

```ts
export type SystemStats = {
  cpu_percent: number;
  ram_percent: number;
  battery_percent: number | null;
};
```

In the `api` object, add after `setRemoteControl`:

```ts
  getSystemStats: () => invoke<SystemStats>("get_system_stats"),
```

- [ ] **Step 2: Write the polling hook**

Create `src/hooks/use-system-stats.ts`:

```ts
import { useEffect, useState } from "react";
import { api, type SystemStats } from "@/lib/tauri";

const HISTORY_LIMIT = 30;
const POLL_MS = 2000;

export function useSystemStats() {
  const [history, setHistory] = useState<SystemStats[]>([]);

  useEffect(() => {
    let cancelled = false;
    const id = window.setInterval(() => {
      void api.getSystemStats().then((stats) => {
        if (cancelled) return;
        setHistory((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), stats]);
      });
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return history;
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint src/lib/tauri.ts src/hooks/use-system-stats.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri.ts src/hooks/use-system-stats.ts
git commit -m "Add frontend system-stats API and polling hook"
```

---

### Task 3: System monitor widget

**Files:**
- Create: `src/components/system-monitor-widget.tsx`

**Interfaces:**
- Consumes: `useSystemStats()` from Task 2, `WIDGET_GLASS`/`WIDGET_RADIUS` from `@/lib/widget-style`, `WidgetNoise` from `@/components/widget-illustrations`.
- Produces: `SystemMonitorWidget` component (no props), default export none (named export only), used by Task 8's `HomeShell`.

- [ ] **Step 1: Write the component**

Create `src/components/system-monitor-widget.tsx`:

```tsx
import { useSystemStats } from "@/hooks/use-system-stats";
import { WidgetNoise } from "@/components/widget-illustrations";
import { cn } from "@/lib/utils";
import { WIDGET_GLASS, WIDGET_RADIUS } from "@/lib/widget-style";

const CHART_WIDTH = 200;
const CHART_HEIGHT = 56;

function toPoints(values: number[]): string {
  if (values.length < 2) return "";
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * CHART_WIDTH;
      const y = CHART_HEIGHT - (Math.min(100, Math.max(0, v)) / 100) * CHART_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function SystemMonitorWidget() {
  const history = useSystemStats();
  const latest = history[history.length - 1];

  const cpuPoints = toPoints(history.map((s) => s.cpu_percent));
  const ramPoints = toPoints(history.map((s) => s.ram_percent));
  const hasBattery = history.some((s) => s.battery_percent != null);
  const batteryPoints = hasBattery
    ? toPoints(history.map((s) => s.battery_percent ?? 0))
    : "";

  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-4 right-4 z-10 w-56 overflow-hidden p-4",
        WIDGET_GLASS,
        WIDGET_RADIUS,
      )}
    >
      <WidgetNoise />
      <span className="relative text-[10px] font-medium uppercase tracking-wide text-white/45">
        System
      </span>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="relative mt-2 h-14 w-full"
        preserveAspectRatio="none"
      >
        {cpuPoints ? (
          <polyline points={cpuPoints} fill="none" stroke="#ff6363" strokeWidth="1.5" />
        ) : null}
        {ramPoints ? (
          <polyline points={ramPoints} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
        ) : null}
        {batteryPoints ? (
          <polyline points={batteryPoints} fill="none" stroke="#34d399" strokeWidth="1.5" />
        ) : null}
      </svg>
      <div className="relative mt-2 flex items-center justify-between text-[10px]">
        <span className="text-[#ff6363]">
          CPU {latest ? Math.round(latest.cpu_percent) : "–"}%
        </span>
        <span className="text-[#60a5fa]">
          RAM {latest ? Math.round(latest.ram_percent) : "–"}%
        </span>
        {latest?.battery_percent != null ? (
          <span className="text-[#34d399]">
            BAT {Math.round(latest.battery_percent)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/system-monitor-widget.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/system-monitor-widget.tsx
git commit -m "Add system monitor widget"
```

---

### Task 4: Icon tray

**Files:**
- Create: `src/components/shell/icon-tray.tsx`

**Interfaces:**
- Produces: `ShellTab` type (`"home" | "agent" | "tasks" | "projects" | "lms" | "data" | "analytics"`), `SHELL_TABS: { id: ShellTab; label: string; icon: LucideIcon }[]`, `IconTray({ activeTab: ShellTab; onTabChange: (tab: ShellTab) => void; pendingCount: number })` component. `ShellTab` and `SHELL_TABS` are consumed by Task 6 (`use-tasks.ts` retyping), Task 7 (`AgentPane`/`PlaceholderPane` callers), and Task 8 (`HomeShell`).

- [ ] **Step 1: Write the component**

Create `src/components/shell/icon-tray.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  BookOpen,
  Database,
  FolderKanban,
  Home,
  ListTodo,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ShellTab =
  | "home"
  | "agent"
  | "tasks"
  | "projects"
  | "lms"
  | "data"
  | "analytics";

export const SHELL_TABS: { id: ShellTab; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "lms", label: "LMS", icon: BookOpen },
  { id: "data", label: "Data", icon: Database },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

export function IconTray({
  activeTab,
  onTabChange,
  pendingCount,
}: {
  activeTab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  pendingCount: number;
}) {
  return (
    <nav className="relative flex w-16 shrink-0 flex-col items-center gap-1 py-4">
      {SHELL_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === activeTab;
        const badge =
          tab.id === "tasks" && pendingCount > 0 ? pendingCount : undefined;
        return (
          <button
            key={tab.id}
            type="button"
            title={tab.label}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "relative flex size-11 flex-col items-center justify-center gap-0.5 rounded-2xl text-ash transition",
              active
                ? "bg-graphite text-pure-white"
                : "hover:bg-obsidian hover:text-pure-white",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={1.75} />
            {badge != null ? (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral-pulse px-1 font-mono text-[9.5px] font-semibold text-white shadow-[0_0_6px_rgba(255,99,99,0.5)]">
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/shell/icon-tray.tsx`
Expected: no errors (existing `tsc -b` will show unrelated pre-existing errors from files this task hasn't touched yet if run mid-plan — that's expected until Task 9; for this step, confirm no *new* errors point at `icon-tray.tsx`).

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/icon-tray.tsx
git commit -m "Add shell icon tray"
```

---

### Task 5: Account menu

**Files:**
- Create: `src/components/shell/account-menu.tsx`

**Interfaces:**
- Produces: `AccountMenu({ accountLabel: string; onSignOut: () => void })` component, consumed by Task 6's `ShellHeader`.

- [ ] **Step 1: Write the component**

Create `src/components/shell/account-menu.tsx`:

```tsx
import { useState } from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function AccountMenu({
  accountLabel,
  onSignOut,
}: {
  accountLabel: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const displayName = accountLabel.replace(/@.*/, "");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex size-7 items-center justify-center rounded-full bg-graphite text-pure-white transition hover:brightness-110",
          open && "ring-2 ring-white/20",
        )}
      >
        <UserRound className="size-3.5" strokeWidth={1.75} />
      </button>
      {open ? (
        <Card className="shadow-key absolute right-0 top-full z-[999] mt-3 w-60 gap-3 border-0 p-3.5">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-wide text-smoke">
              Signed In
            </p>
            <p className="truncate font-mono text-[12.5px] text-pure-white">
              {displayName}
            </p>
          </div>
          <Separator />
          <Button
            variant="destructive"
            className="h-8 w-full text-coral-pulse"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign Out
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/shell/account-menu.tsx`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/account-menu.tsx
git commit -m "Add shell account menu"
```

---

### Task 6: Shell header

**Files:**
- Create: `src/components/shell/shell-header.tsx`
- Modify: `src/hooks/use-tasks.ts`

**Interfaces:**
- Consumes: `AccountMenu` from Task 5, `windowControls` from `@/lib/tauri`, `WIDGET_GLASS`/`WIDGET_RADIUS` from `@/lib/widget-style`, `WidgetNoise` from `@/components/widget-illustrations`, `ShellTab` from Task 4.
- Produces: `ShellHeader({ collapsed: boolean; onToggleCollapsed: () => void; accountLabel: string; onSignOut: () => void })`, consumed by Task 8's `HomeShell`.

- [ ] **Step 1: Write the header**

Create `src/components/shell/shell-header.tsx`:

```tsx
import { ChevronDown, ChevronUp } from "lucide-react";
import { AccountMenu } from "@/components/shell/account-menu";
import { WidgetNoise } from "@/components/widget-illustrations";
import { windowControls } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { WIDGET_GLASS, WIDGET_RADIUS } from "@/lib/widget-style";

const CONTROLS = [
  { title: "Close", color: "#ff5f57", action: windowControls.close },
  { title: "Minimize", color: "#febc2e", action: windowControls.minimize },
  { title: "Fullscreen", color: "#28c840", action: windowControls.toggleMaximize },
] as const;

export function ShellHeader({
  collapsed,
  onToggleCollapsed,
  accountLabel,
  onSignOut,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  accountLabel: string;
  onSignOut: () => void;
}) {
  return (
    <div
      className={cn(
        "no-drag pointer-events-auto relative w-full overflow-hidden",
        WIDGET_GLASS,
        WIDGET_RADIUS,
      )}
    >
      <WidgetNoise />
      <div
        data-tauri-drag-region
        className="relative flex w-full items-center p-4"
      >
        <div className="flex items-center gap-1.5">
          {CONTROLS.map((control) => (
            <button
              key={control.title}
              type="button"
              title={control.title}
              onClick={() => void control.action()}
              className="size-2.5 rounded-full transition hover:brightness-110"
              style={{ backgroundColor: control.color }}
            />
          ))}
          <button
            type="button"
            title={collapsed ? "Expand" : "Collapse"}
            onClick={onToggleCollapsed}
            className="ml-1.5 flex size-4 items-center justify-center rounded-full text-white/50 transition hover:text-pure-white"
          >
            {collapsed ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronUp className="size-3.5" />
            )}
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center">
          <span className="text-[13px] font-medium text-pure-white">Vox</span>
          <span className="font-mono text-[9px] text-white/40">
            v{__APP_VERSION__}
          </span>
        </div>
        <AccountMenu accountLabel={accountLabel} onSignOut={onSignOut} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Retype `use-tasks.ts`'s view parameter**

In `src/hooks/use-tasks.ts`, change:

```ts
import type { DesktopView } from "@/app";
```

to:

```ts
import type { ShellTab } from "@/components/shell/icon-tray";
```

and change the function signature:

```ts
export function useTasks(signedIn: boolean, view: DesktopView) {
```

to:

```ts
export function useTasks(signedIn: boolean, view: ShellTab) {
```

(The `view !== "tasks"` check inside the hook body is unchanged — `"tasks"` is still a valid `ShellTab`.)

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/shell/shell-header.tsx src/hooks/use-tasks.ts`
Expected: `use-tasks.ts` will show an error that `@/app` no longer exports `DesktopView` only if Task 9 hasn't run yet and `app.tsx` still exports it — that's fine, `app.tsx` is rewritten in Task 9. Confirm `shell-header.tsx` itself has no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/shell-header.tsx src/hooks/use-tasks.ts
git commit -m "Add shell header, retype useTasks for ShellTab"
```

---

### Task 7: Agent pane and placeholder pane

**Files:**
- Create: `src/components/shell/agent-pane.tsx`
- Create: `src/components/shell/placeholder-pane.tsx`

**Interfaces:**
- Produces: `AgentPane({ isActive: boolean; callState: string; label: string; subLabel: string; callError: string; onToggleCall: () => void })`, `PlaceholderPane({ label: string })`. Both consumed by Task 8's `HomeShell`.

- [ ] **Step 1: Write the agent pane**

Create `src/components/shell/agent-pane.tsx`:

```tsx
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function AgentPane({
  isActive,
  callState,
  label,
  subLabel,
  callError,
  onToggleCall,
}: {
  isActive: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  onToggleCall: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <TalkPane
        isActive={isActive}
        callState={callState}
        label={label}
        subLabel={subLabel}
        callError={callError}
        onToggleCall={onToggleCall}
      />
      <ActivityLogPane />
    </div>
  );
}

function TalkPane({
  isActive,
  callState,
  label,
  subLabel,
  callError,
  onToggleCall,
}: {
  isActive: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  onToggleCall: () => void;
}) {
  const connecting = callState === "connecting";
  const expanded = isActive || connecting;
  const status = callError || (expanded ? label : subLabel);

  return (
    <button
      type="button"
      onClick={onToggleCall}
      title={isActive ? "End call" : "Talk to Vox"}
      className="pointer-events-auto flex w-[70%] flex-col items-center justify-center gap-2 overflow-hidden p-4 text-center transition"
    >
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full transition",
          isActive
            ? "bg-ember-hush text-coral-pulse"
            : "bg-white/8 text-pure-white",
        )}
      >
        {isActive || connecting ? (
          <MicOff className="size-6" />
        ) : (
          <Mic className="size-6" />
        )}
      </span>
      <span className="text-[14px] font-medium text-pure-white">
        Talk to Vox
      </span>
      {status ? (
        <span
          className={cn(
            "line-clamp-2 max-w-[85%] text-[11px] leading-snug",
            callError ? "text-coral-pulse" : "text-white/50",
          )}
        >
          {status}
        </span>
      ) : null}
    </button>
  );
}

function ActivityLogPane() {
  return (
    <div className="flex w-[30%] shrink-0 flex-col border-l border-white/10 p-4">
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-white/45">
        Activity
      </span>
      <p className="mt-2 text-[11px] text-white/40">
        Agent activity — coming soon
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write the placeholder pane**

Create `src/components/shell/placeholder-pane.tsx`:

```tsx
export function PlaceholderPane({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <p className="font-mono text-[12px] text-white/40">{label} — coming soon</p>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/shell/agent-pane.tsx src/components/shell/placeholder-pane.tsx`
Expected: no errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/agent-pane.tsx src/components/shell/placeholder-pane.tsx
git commit -m "Add shell agent pane and placeholder pane"
```

---

### Task 8: Home shell

**Files:**
- Create: `src/components/home-shell.tsx`

**Interfaces:**
- Consumes: `ShellHeader` (Task 6), `IconTray`/`SHELL_TABS`/`ShellTab` (Task 4), `AgentPane`/`PlaceholderPane` (Task 7), `SystemMonitorWidget` (Task 3), `WIDGET_GLASS`/`WIDGET_RADIUS` (`@/lib/widget-style`), `useMissionMap` (`@/hooks/use-mission-map`), `MapAmbientChrome` (`@/components/map-ambient-chrome`), `TasksView`/`ProjectsView`/`ProjectDetailView` (existing), `Collection`/`DesktopTask` types and `NewProjectForm` type (existing).
- Produces: `HomeShell` component, consumed by Task 9's `app.tsx`. Full prop signature is written out in Step 1 below.

- [ ] **Step 1: Write the component**

Create `src/components/home-shell.tsx`:

```tsx
import { useState, type ReactNode } from "react";
import { AgentPane } from "@/components/shell/agent-pane";
import { IconTray, SHELL_TABS, type ShellTab } from "@/components/shell/icon-tray";
import { PlaceholderPane } from "@/components/shell/placeholder-pane";
import { ShellHeader } from "@/components/shell/shell-header";
import { MapAmbientChrome } from "@/components/map-ambient-chrome";
import type { NewProjectForm } from "@/components/new-project-dialog";
import { ProjectDetailView } from "@/components/project-detail-view";
import { ProjectsView } from "@/components/projects-view";
import { SystemMonitorWidget } from "@/components/system-monitor-widget";
import { TasksView } from "@/components/tasks-view";
import { useMissionMap } from "@/hooks/use-mission-map";
import type { Collection, DesktopTask } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { WIDGET_GLASS, WIDGET_RADIUS } from "@/lib/widget-style";

export function HomeShell({
  activeTab,
  onTabChange,
  accountLabel,
  onSignOut,
  isActive,
  callState,
  label,
  subLabel,
  callError,
  onToggleCall,
  pendingCount,
  tasks,
  totalTasks,
  page,
  totalPages,
  pageSize,
  filter,
  search,
  tasksLoading,
  onFilterChange,
  onSearchChange,
  onReloadTasks,
  onNewTask,
  onPageChange,
  onToggleTaskStatus,
  onInspectTask,
  collections,
  projectsError,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onArchiveProject,
}: {
  activeTab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  accountLabel: string;
  onSignOut: () => void;
  isActive: boolean;
  callState: string;
  label: string;
  subLabel: string;
  callError: string;
  onToggleCall: () => void;
  pendingCount: number;
  tasks: DesktopTask[];
  totalTasks: number;
  page: number;
  totalPages: number;
  pageSize: number;
  filter: string;
  search: string;
  tasksLoading: boolean;
  onFilterChange: (filter: string) => void;
  onSearchChange: (search: string) => void;
  onReloadTasks: () => void;
  onNewTask: () => void;
  onPageChange: (page: number) => void;
  onToggleTaskStatus: (task: DesktopTask) => void;
  onInspectTask: (task: DesktopTask) => void;
  collections: Collection[];
  projectsError?: string;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onCreateProject: (form: NewProjectForm) => Promise<void>;
  onArchiveProject: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { mapNode, mapReady, mapError } = useMissionMap();

  let body: ReactNode;
  if (activeTab === "agent") {
    body = (
      <AgentPane
        isActive={isActive}
        callState={callState}
        label={label}
        subLabel={subLabel}
        callError={callError}
        onToggleCall={onToggleCall}
      />
    );
  } else if (activeTab === "tasks") {
    body = (
      <TasksView
        tasks={tasks}
        totalTasks={totalTasks}
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        filter={filter}
        search={search}
        tasksLoading={tasksLoading}
        onFilterChange={onFilterChange}
        onSearchChange={onSearchChange}
        onReload={onReloadTasks}
        onNewTask={onNewTask}
        onCollapse={() => onTabChange("agent")}
        onPageChange={onPageChange}
        onToggleStatus={onToggleTaskStatus}
        onInspect={onInspectTask}
      />
    );
  } else if (activeTab === "projects") {
    body = selectedProjectId ? (
      <ProjectDetailView
        project={
          collections.find((c) => c.id === selectedProjectId) ?? {
            id: selectedProjectId,
            name: "Project",
            description: "",
            kind: "project",
            status: "active",
          }
        }
        onBack={() => onSelectProject(null)}
        onInspectTask={onInspectTask}
      />
    ) : (
      <ProjectsView
        collections={collections}
        error={projectsError}
        onSelectProject={onSelectProject}
        onCreateProject={onCreateProject}
        onArchiveProject={onArchiveProject}
        onCollapse={() => onTabChange("agent")}
      />
    );
  } else {
    const tabMeta = SHELL_TABS.find((t) => t.id === activeTab);
    body = <PlaceholderPane label={tabMeta?.label ?? "This"} />;
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#0b0c0e]">
      <div
        ref={mapNode}
        className="vox-map-host absolute inset-0"
        style={{ background: "#0b0c0e" }}
      />
      <MapAmbientChrome />

      <div className="no-drag pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col p-3.5">
        <div className="pointer-events-auto">
          <ShellHeader
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((v) => !v)}
            accountLabel={accountLabel}
            onSignOut={onSignOut}
          />
        </div>
        {!collapsed ? (
          <div
            className={cn(
              "pointer-events-auto relative mt-2.5 flex h-[380px] overflow-hidden",
              WIDGET_GLASS,
              WIDGET_RADIUS,
            )}
          >
            <IconTray
              activeTab={activeTab}
              onTabChange={onTabChange}
              pendingCount={pendingCount}
            />
            <div className="flex min-h-0 flex-1 flex-col border-l border-white/10">
              {body}
            </div>
          </div>
        ) : null}
      </div>

      <SystemMonitorWidget />

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
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/home-shell.tsx`
Expected: no errors from this file (project-wide `tsc -b` may still show `app.tsx`/old-file errors until Task 9 — ignore those here).

- [ ] **Step 3: Commit**

```bash
git add src/components/home-shell.tsx
git commit -m "Add HomeShell"
```

---

### Task 9: Wire into App, delete the old widget system, verify end to end

**Files:**
- Modify: `src/app.tsx`
- Modify: `src/lib/widget-style.ts`
- Delete: `src/components/dashboard-view.tsx`
- Delete: `src/components/titlebar-widget.tsx`
- Delete: `src/components/talk-to-vox-widget.tsx`

**Interfaces:**
- Consumes: `HomeShell` (Task 8) and its full prop list exactly as defined there.

- [ ] **Step 1: Rewrite `app.tsx`**

Replace the full contents of `src/app.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { HomeShell } from "@/components/home-shell";
import { InspectTaskDialog } from "@/components/inspect-task-dialog";
import { NewTaskDialog, type NewTaskForm } from "@/components/new-task-dialog";
import type { ShellTab } from "@/components/shell/icon-tray";
import { SignInScreen } from "@/components/sign-in-screen";
import { useAuth } from "@/hooks/use-auth";
import { useCallSession } from "@/hooks/use-call-session";
import { useProjects } from "@/hooks/use-projects";
import { PAGE_SIZE, useTasks } from "@/hooks/use-tasks";
import { statusLabel } from "@/lib/status";
import type { DesktopTask } from "@/lib/tauri";

const emptyNewTask: NewTaskForm = {
  title: "",
  instruction: "",
  execType: "autonomous",
  collectionId: "",
  due: "Today",
};

export default function App() {
  const auth = useAuth();
  const callSession = useCallSession(auth.auth.signed_in);

  const [activeTab, setActiveTab] = useState<ShellTab>("agent");
  const tasksHook = useTasks(auth.auth.signed_in, activeTab);
  const projectsHook = useProjects(auth.auth.signed_in);

  const [showNewTask, setShowNewTask] = useState(false);
  const [inspectTask, setInspectTask] = useState<DesktopTask | null>(null);
  const [newTask, setNewTask] = useState<NewTaskForm>(emptyNewTask);

  const { auth: authState, authBusy, authError, googleSignIn, signOut } = auth;
  const {
    callState,
    isActive,
    isBusy,
    isSpeaking,
    callError,
    toggleCall,
    endCall,
  } = callSession;
  const {
    tasks,
    tasksLoading,
    page,
    setPage,
    totalTasks,
    totalPages,
    filter,
    setFilter,
    search,
    setSearch,
    pendingCount,
    loadTasks,
    createTask,
    toggleTaskStatus,
  } = tasksHook;
  const {
    collections,
    selectedProjectId,
    setSelectedProjectId,
    projectsError,
    createProject,
    archiveProject,
  } = projectsHook;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Enter" &&
        authState.signed_in &&
        activeTab === "agent" &&
        !isActive &&
        !isBusy
      ) {
        void toggleCall();
      } else if (e.key === "Escape") {
        if (showNewTask) setShowNewTask(false);
        else if (inspectTask) setInspectTask(null);
        else if (activeTab === "projects" && selectedProjectId)
          setSelectedProjectId(null);
        else if (activeTab !== "agent") setActiveTab("agent");
        else if (isActive || callState === "connecting") void endCall();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers use latest state via closure refresh
  }, [
    authState.signed_in,
    activeTab,
    isActive,
    isBusy,
    showNewTask,
    inspectTask,
    callState,
    selectedProjectId,
  ]);

  async function handleGoogleSignIn() {
    await googleSignIn(loadTasks);
  }

  async function handleCreateTask() {
    const created = await createTask(newTask);
    if (created) {
      setNewTask(emptyNewTask);
      setShowNewTask(false);
    }
  }

  const label = statusLabel(callState, callError);
  const subLabel = isActive
    ? isSpeaking
      ? "Speaking… (listening)"
      : "Listening… speak naturally"
    : isBusy || callState === "connecting"
      ? "Establishing duplex audio link…"
      : "Press the button or hit Return to talk";

  if (!authState.signed_in) {
    return (
      <SignInScreen
        busy={authBusy}
        error={authError}
        onSignIn={() => void handleGoogleSignIn()}
      />
    );
  }

  return (
    <main
      className="relative h-full w-full overflow-hidden bg-void-black"
      tabIndex={0}
    >
      <HomeShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        accountLabel={authState.email ?? authState.user_id ?? "Signed in"}
        onSignOut={() => void signOut()}
        isActive={isActive}
        callState={callState}
        label={label}
        subLabel={subLabel}
        callError={callError}
        onToggleCall={() => void toggleCall()}
        pendingCount={pendingCount}
        tasks={tasks}
        totalTasks={totalTasks}
        page={page}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        filter={filter}
        search={search}
        tasksLoading={tasksLoading}
        onFilterChange={(v) => {
          setFilter(v);
          setPage(1);
        }}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        onReloadTasks={() => void loadTasks()}
        onNewTask={() => setShowNewTask(true)}
        onPageChange={setPage}
        onToggleTaskStatus={(task) => void toggleTaskStatus(task)}
        onInspectTask={setInspectTask}
        collections={collections}
        projectsError={projectsError}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onCreateProject={createProject}
        onArchiveProject={(id) => void archiveProject(id)}
      />

      <NewTaskDialog
        open={showNewTask}
        form={newTask}
        collections={collections}
        onOpenChange={setShowNewTask}
        onChange={(patch) => setNewTask((prev) => ({ ...prev, ...patch }))}
        onSubmit={() => void handleCreateTask()}
      />

      <InspectTaskDialog
        task={inspectTask}
        onClose={() => setInspectTask(null)}
      />
    </main>
  );
}
```

- [ ] **Step 2: Trim `widget-style.ts`**

Replace the full contents of `src/lib/widget-style.ts` with:

```ts
export const WIDGET_GLASS =
  "border border-white/10 bg-black/50 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl";
export const WIDGET_RADIUS = "rounded-[24px]";
```

- [ ] **Step 3: Delete the retired files**

```bash
git rm src/components/dashboard-view.tsx src/components/titlebar-widget.tsx src/components/talk-to-vox-widget.tsx
```

- [ ] **Step 4: Confirm nothing else references the deleted files or removed exports**

Run: `grep -rn "dashboard-view\|titlebar-widget\|talk-to-vox-widget\|GRID_CELL\|GRID_GAP\|GRID_PAD\|WIDGET_SIZE\|TITLEBAR_SPACE\|DesktopView" src --include="*.tsx" --include="*.ts"`
Expected: no matches.

- [ ] **Step 5: Full typecheck, lint, and Rust build**

Run: `npx tsc -b --noEmit`
Expected: no errors.

Run: `npx eslint src`
Expected: no errors.

Run: `cd src-tauri && cargo build`
Expected: builds with no errors.

- [ ] **Step 6: Manual browser walkthrough**

Start the dev server (`npm run dev` / the project's `vox-desktop-web` launch config) and open it in a browser. Since `auth.signed_in` gates the whole app and there's no way to complete real Google OAuth in a plain browser preview, temporarily change the `if (!authState.signed_in)` check in `app.tsx` to `if (!authState.signed_in && false)`, reload, and verify:

- The header spans the full width at the top: 3 traffic-light dots, a 4th collapse-toggle button, "Vox" + version centered, an avatar on the right.
- Clicking each of the 7 icon tray icons switches the body content; Agent is selected by default on load.
- The Agent tab shows the mic/"Talk to Vox" pane on the left (~70% width) and a static "Agent activity — coming soon" pane on the right (~30% width).
- Tasks and Projects tabs render their real views (task table, project list) — not placeholders.
- Home, LMS, Data, Analytics show "<Label> — coming soon".
- The collapse-toggle button hides the body (header stays visible); clicking it again restores the body — switch to Tasks first, collapse, expand, and confirm it lands back on Tasks, not Agent.
- The account avatar opens a dropdown showing the signed-in identity and a working "Sign Out" button that returns to `SignInScreen`.
- The system monitor card renders bottom-right, above the map, below the header/body panel. Its CPU/RAM (and battery, if the machine has one) numbers may look off on the very first reading — watch it through a second poll (~2s later) and confirm it settles to a plausible value.
- Start a call from the Agent tab, switch to another tab (e.g. Tasks) while it's active, then switch back to Agent — the mic must still show as active/connected, not reset.

Once verified, revert the temporary `&& false` change back to `if (!authState.signed_in) {`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Wire HomeShell into App, retire the bento widget system"
```
