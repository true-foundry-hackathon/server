# Home shell redesign

Date: 2026-09-25
Status: approved (chat), pending spec review

## Summary

Retire the bento/widget-grid home screen (`DashboardView`'s cell grid, `TitlebarWidget`, the floating `TalkToVoxWidget`, and the `StatWidget` instances for Location and Desktop Link) in favor of a single docked app shell: a full-width header bar plus a collapsible body with a left icon-tray nav and per-tab content. The 3D map keeps filling the window behind it. A new system resource monitor (CPU/RAM/battery) becomes the one remaining floating card, bottom-right.

Source: user sketch + verbal walkthrough (2026-09-25), design confirmed in chat.

## Goals

- One docked panel (header + body) spanning the full window width, pinned to the top, above the map in z-order.
- Header: window controls (close/minimize/fullscreen) + a 4th control that collapses only the body; centered "Vox" wordmark + version; user avatar on the right opening an account/sign-out menu.
- Body: left icon tray (Home, Agent, Tasks, Projects, LMS, Data, Analytics) + right content pane for the selected tab. Agent is the default tab, not Home.
- Agent tab: 70% mic/"talk to Vox" pane (content of today's `TalkToVoxWidget`, no longer a floating card) + 30% activity log pane (placeholder content — no data source exists yet, see Non-goals).
- New system monitor widget: bottom-right floating card, above the map, below the header/body panel. Live CPU%, RAM%, battery% via a new Tauri command, rendered as one combined rolling line graph.
- Restore sign-out, which has had no UI entry point since the old `AppSidebar` was deleted earlier in this app's history.

## Non-goals (this pass)

- Real data for the Agent tab's activity log. Nothing in the app today emits a "what is Vox doing" event stream (`use-call-session` only exposes idle/active/speaking). Ship the panel as static placeholder content; the event-stream design is a separate follow-up.
- New content for Home, Tasks, Projects, LMS, Data, Analytics tabs beyond what already existed (Tasks and Projects keep their real views; the rest stay "coming soon" placeholders, matching the pre-deletion `AppSidebar` behavior).
- Any change to the map itself, auth flow, or the vox-bridge auth page.

## Architecture

Replace `DashboardView` with a new `HomeShell` component tree:

```
HomeShell
├── ShellHeader          (docked top, full width, always visible)
│   ├── window controls (close/minimize/fullscreen) + body-collapse toggle
│   ├── "Vox" + version (centered)
│   └── AccountMenu (avatar, right — click opens sign-out/account dropdown)
├── ShellBody             (collapsible; height animates to 0 when collapsed)
│   ├── IconTray           (left rail: Home, Agent, Tasks, Projects, LMS, Data, Analytics)
│   └── <selected tab content>
│       ├── AgentPane (default): TalkPane (70%) + ActivityLogPane (30%, placeholder)
│       ├── TasksView / ProjectsView (existing, reused as-is)
│       └── PlaceholderPane (Home, LMS, Data, Analytics — "coming soon")
└── SystemMonitorWidget    (independent floating card, bottom-right)
```

Z-order (bottom to top): 3D map → `SystemMonitorWidget` → `HomeShell` (header+body).

`HomeShell` owns the `view`/`activeSection` state that used to live in `App` before the old sidebar was deleted (`DesktopView` routing for dashboard/tasks/projects, plus a new tab id for the icon tray's extra sections). `App.tsx` renders `HomeShell` instead of composing `DashboardView` + ad hoc titlebar pinning for non-dashboard views — the shell is now the permanent chrome for every view, not just the dashboard.

## Header bar

- Reuses the existing `windowControls` API (`close`, `minimize`, `toggleMaximize`) from `lib/tauri.ts`, same as today's `TitlebarWidget`.
- New 4th button (after fullscreen): collapses/expands the body. Header never collapses. Collapse state is local UI state (not persisted across launches, matching how `showProfile` etc. worked before).
- Center: "Vox" + version text, stacked, matching the current `TitlebarWidget`'s content, just recentered instead of left-aligned.
- Right: avatar button (initials or icon) opens a small dropdown: account email (from `authState.email`), Sign Out. This restores the sign-out entry point lost when `AppSidebar` was removed.
- Full width, one instance, rendered once by `HomeShell` (not duplicated per-view like the old titlebar-pinning hack in `App.tsx`).

## Icon tray & tabs

Sections: Home, Agent, Tasks, Projects, LMS, Data, Analytics — the same set `AppSidebar` had before deletion (Home/Tasks/Projects were `DesktopView`; LMS/Data/Analytics were `SidebarSectionId`). Agent is new — it replaces the floating `TalkToVoxWidget` and becomes the default selected tab on load.

Tasks and Projects render their existing `TasksView` / `ProjectsView` components unchanged. Home, LMS, Data, Analytics render a placeholder pane ("coming soon"), matching the previous behavior. Agent renders `AgentPane`.

## Agent pane

- Left ~70%: the mic button, "Talk to Vox" label, and status/sub-label text — the same content and state (`isActive`, `callState`, `label`, `subLabel`, `callError`, `onToggleCall`) currently passed into `TalkToVoxWidget`, but laid out as a pane, not a bordered floating card.
- Right ~30%: `ActivityLogPane`, static placeholder ("Agent activity — coming soon" or similar). No backend wiring in this pass.

## System monitor widget

- New Tauri command (e.g. `get_system_stats`) in `src-tauri`, added to the existing `invoke_handler!` list, returning `{ cpu_percent: f32, ram_percent: f32, battery_percent: Option<f32> }`.
- New Cargo dependencies: `sysinfo` (CPU + RAM, cross-platform) and `starship-battery` (battery %, cross-platform, MIT). `battery_percent` is `Option` because desktops/some platforms have no battery.
- Frontend: a new hook (e.g. `use-system-stats.ts`) polls the command on an interval (matching the existing `use-call-session` / `use-device-link` polling pattern — no push/event needed for this), keeping a short rolling history buffer in React state for the graph.
- Rendered as a small floating card, bottom-right, keeping the existing glass material (`WIDGET_GLASS`, `WidgetNoise`) — the one deliberate holdover from the retired widget system, since the user's sketch explicitly draws it as its own box.
- One combined line graph, three series (CPU/RAM/battery), short rolling window (exact window size and chart implementation are plan-level detail, not spec-level).

## What gets deleted

- `dashboard-view.tsx`'s bento grid entirely (the `place()` helper, the `<div className="grid">` wrapper, `StatWidget`).
- `TitlebarWidget` (superseded by `ShellHeader`).
- `TalkToVoxWidget` as a floating card (its content moves into `AgentPane`'s talk pane; the component may be adapted/renamed rather than rewritten from scratch).
- Both `StatWidget` instances (Location, Desktop Link) and their data (`useMissionMap`'s location/locationSource/permissionDenied UI, `useDeviceLink`'s status UI) — dropped, not relocated. The underlying hooks (`use-mission-map`, `use-device-link`) stay; only their widget-card presentation goes away. If `useDeviceLink`'s remote-control toggle needs a UI home later, that's a follow-up.
- `widget-style.ts`'s grid/cell system (`GRID_CELL`, `GRID_GAP`, `GRID_PAD`, `cells()`, `WIDGET_SIZE`, `TITLEBAR_SPACE`) — no longer needed once nothing is grid-placed. `WIDGET_GLASS` and `WIDGET_RADIUS` survive for the system monitor card.
- `widget-illustrations.tsx`'s `WidgetNoise` — kept, reused on the header/body panel and the system monitor card.

## Open questions for the implementation plan (not blocking this spec)

- Exact icon set/library choices for the 7 tray sections beyond Home/Tasks/Projects (which already have icons from the old sidebar).
- Chart library or hand-rolled SVG for the system monitor's line graph (repo already has no charting dependency).
- Whether the body-collapse toggle animates (height transition) or snaps instantly.
