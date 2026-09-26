# Raycast Design System & Vox Desktop Specification

> Midnight command center, coral neon. Unified design guidelines for Vox Web and Vox Desktop applications.

**Theme:** Dark (`#040506` canvas base)

---

## 1. Design Philosophy & Aesthetic Roots

Vox shares the design DNA of Raycast: high-density, keyboard-first, ultra-responsive native desktop and web experiences. Visual cues favor dark obsidian panels, recessed wells, hairline borders (`#232427` / `#2a2b2e`), and subtle coral neon brand accents (`#ff6363`) that distinguish live agent states from background telemetry.

---

## 2. Color Palette & Semantic Tokens

### Backgrounds & Surfaces
| Token | Hex | Role | Usage |
|---|---|---|---|
| **Void Black** | `#040506` | Canvas Base | Window background, primary layout backdrop |
| **Ink** | `#07080a` | Elevated Surface | Sidebars, cards, modals, table headers |
| **Obsidian** | `#111214` | Recessed Wells | Form inputs, inactive buttons, table rows |
| **Graphite** | `#1b1c1e` | Active / Hover Wells | Active sidebar pills, button hover states |
| **Slate** | `#2f3031` | Border Accent | Secondary buttons, stroke dividers |

### Text & Accents
| Token | Hex | Role | Usage |
|---|---|---|---|
| **Pure White** | `#ffffff` | Primary High-Emphasis | Headings, active text, key titles |
| **Mist** | `#e6e6e6` | Primary Action Fill | Primary action buttons (`btn-primary-mist`) |
| **Iron** | `#454647` | Action Text | Contrast text on light fills |
| **Ash** | `#9c9c9d` | Secondary Text | Subtitles, metadata, inactive icons |
| **Smoke** | `#6a6b6c` | Tertiary / Labels | Field labels, timestamps, shortcuts |
| **Coral Pulse** | `#ff6363` | Brand Neon Accent | Voice active state, agent highlights, indicators |
| **Ember Hush** | `#452324` | Danger / Call State | End call button fill, error callouts |
| **Electric Sky** | `#63a1ff` | Interactive Mode | Interactive task badges, secondary actions |
| **Success Green**| `#59d499` | Completion State | Completed task badges, live socket dot |

### Radii & Elevation
- **Cards & Modals**: `16px` / `20px` (`--radius-cards`, `--radius-largecards`)
- **Buttons & Inputs**: `8px` (`--radius-buttons`, `--radius-inputs`)
- **Badges & Pills**: `6px` / `9999px` (`--radius-badges`, `--radius-pills`)
- **Borders & Shadows**:
  - Featured cards and elevated panels use the Raycast **keyboard key** stack:
    `rgba(255,255,255,0.05) inset top + rgba(255,255,255,0.25) outer ring + rgba(0,0,0,0.2) inset bottom`
  - Primary mist buttons use a subtle lift: `--shadow-btn-lift`
  - Avoid chromatic CTAs — primary actions are Mist fill / Iron text
  - Coral Pulse (`#ff6363`) is reserved for brand mark, AI badges, and live voice states

---

## 3. Desktop Application Architecture & Sizing

### Window Lifecycle & Sizing
- **Unauthenticated (Sign In) State**:
  - Window Dimension: `800 x 600 px`, **automatically centered on the screen**.
  - Window Chrome: Frameless with 36px top drag region (`.window-drag-bar` / `data-tauri-drag-region`).
  - Hero Section: Large animated Vox orb (`120px`), "Continue with Google" action button (`btn-primary-mist`).
- **Authenticated (Signed In) State**:
  - Window Dimension: **Scaled dynamically to `1200 x 800 px`** via Tauri IPC `set_window_size`.
  - Window Chrome: Full width/height workspace layout (`.raycast-shell.authenticated-workspace`).
  - On sign out, the window automatically scales back down to `800 x 600 px` and **re-centers directly to the middle of the screen** (`window.center()` via Tauri `center_window`).

---

## 4. Layout & Navigation

### Persistent Left Icon Sidebar Rail (`.sidebar-rail`)
- **Width**: `64px` fixed, Void Black / Ink background with right hairline border.
- **Top Group**:
  1. **Brand Diamond**: Mini Vox Coral Diamond (`CoralDiamond`), clicks to reset to Cockpit Dashboard.
  2. **Dashboard Icon** (`DashboardIcon`): Switches to the central Voice Cockpit.
  3. **Tasks Icon** (`TasksIcon`): Expands the full-width Tasks Drawer to the right edge. Features a dynamic notification badge indicating pending/executing background tasks.
- **Bottom Group**:
  1. **User Profile Avatar** (`UserAvatarIcon`): Shows user status.
  2. **Profile Popover**: Clicking toggles a Raycast popover displaying account email, bridge WebRTC endpoint (`bridge.voxagent.in`), audio codec status (`Opus 48kHz`), and a "Sign Out" button.

---

## 5. Main Stage Views

### View 1: Center Voice Cockpit (Dashboard)
When active view is `Dashboard`:
- **Stage Container**: Center-aligned within the 1200px workspace.
- **Interactive Hero Animating Orb (240px)**:
  - Big slow-animating canvas orb (`size: 240px`) serving as the central interactive control.
  - Centered Frosted Mic Button (`.orb-center-mic`): Centered inside the orb with a frosted glass backdrop and hairline border.
  - **Dynamic Audio Reactive Speed**:
    - *Idle / Quiet*: Animates slowly and tranquilly at `0.35x` speed.
    - *Connecting*: Ramps up to `1.8x` speed with connecting gold/amber tone.
    - *User Speaking*: Continuous audio RMS detector monitors CPAL input stream (`mic_level > 0.012`) and triggers `is_speaking = true`. The orb animates **violently and fast at `3.5x` speed** with an amplified coral neon aura (`#ff6363`) and expanded center mic icon.
    - *User Quiet / Listening*: Automatically eases back down to gentle `1.0x` speed.
  - Clicking anywhere on the orb starts or ends the duplex voice communication session.

### View 2: Expanded Tasks Drawer (`.tasks-expanded-view`)
When active view is `Tasks`:
- **Expansion Behavior**:
  - Expands from the 64px sidebar rail completely across to the far right edge of the window (`flex: 1`, full remaining 1136px).
  - The left sidebar icons remain visible and interactive on the left rail.
- **Top Right Corner Collapse Button**:
  - Dedicated collapse button with `CollapseIcon` in the top right corner (`.btn-collapse-drawer`).
  - Tooltip: "Collapse to Dashboard (Esc)".
  - Clicking collapses the view back to the Center Voice Cockpit.
- **Header & Filter Bar**:
  - Title: "Agent Tasks" with total task counter pill.
  - Quick reload button (`RefreshIcon`) and "+ New Task" button (`PlusIcon`).
  - Filter pills: "All", "Pending", "Executing", "Completed".
  - Instant text filter input for title, instruction, and project.
- **Dedicated Tasks Table**:
  - Strictly aligned with `vox-core` database table (`tasks`) and agent tool schemas (`CreateTask`, `ListTasks`, `UpdateTask`):
    - `STATUS`: Pill badges for `pending`, `executing` (with pulsing coral dot), `completed` (with checkmark), and `failed`.
    - `TASK & INSTRUCTION`: Title in bold pure white, instruction text snippet in ash.
    - `EXECUTION TYPE`: Badges for `autonomous` (AI sparkles badge), `interactive`, and `manual_human`.
    - `PROJECT`: Linked project/collection name tag.
    - `DUE`: Clock icon with due window or timestamp.
    - `ACTIONS`: Quick checkmark toggle button to complete/reopen task, plus "View" button to open the full detail inspector.
- **Database Querying & Raycast Pagination Bar**:
  - Direct integration with Supabase PostgREST database endpoint (`/rest/v1/tasks?select=*&order=created_at.desc&limit=...&offset=...`) using JWT session tokens, with fallback to Vox Core API and persistent local JSON disk cache (`~/.config/vox/tasks_db.json`).
  - Total database record count extracted via HTTP `Content-Range` (`0-9/42`) and SQL `count(*)`.
  - Raycast Pagination Footer Bar (`.tasks-pagination-bar`):
    - Info: "Showing X–Y of Z tasks" or "No tasks found".
    - Controls: Previous button (`← Prev`), interactive numbered page pills (`[1]`, `[2]`, `[3]`), and Next button (`Next →`).
    - Reset to page 1 on search or filter change.

---

## 6. Modals & Inspectors

### 1. Create Agent Task Modal
- Inputs:
  - Task Title
  - Detailed Instruction (textarea for autonomous worker)
  - Execution Mode dropdown (`Autonomous (Agent)`, `Interactive`, `Manual Tracking`)
  - Project / Collection
  - Due Date / Target window
- Actions: "Cancel" and "Create Task".

### 2. Task Details Inspector Modal
- Inspects complete agent execution telemetry:
  - Status and Title
  - Full instructions
  - Agent Feasibility Reasoning (`feasibility_reasoning` generated by `vox-core` agent)
  - Formatted JSON Execution Result payload (`execution_result`)
  - Task ID and creation timestamps

---

## 7. Keyboard Navigation & Shortcuts

| Key | Context | Action |
|---|---|---|
| `↵ Return` | Dashboard (Idle) | Start voice session / unmute mic |
| `Esc` | Active Voice Session | End call / mute voice channel |
| `Esc` | Tasks View | Collapse back to Dashboard view |
| `Esc` | Modals Open | Close active modal / inspector |

---

## 8. Cross-Platform Consistency (Web & Desktop)
- Design tokens and typography (`Inter` for UI, `Geist Mono` for IDs, timestamps, and status tags) are shared between `vox-web` and `vox-desktop`.
- Window controls and frame behavior conform to native macOS design guidelines while maintaining the Raycast dark palette.

## 9. Component Library (shadcn-style Dioxus primitives)

Desktop UI is composed from `src/ui/` primitives that mirror shadcn/ui APIs, styled with Raycast tokens:

| Primitive | Variants / Notes |
|---|---|
| `Button` | `Default` (Mist/Iron), `Secondary`, `Ghost`, `Outline`, `Destructive` (Ember/Coral), `Icon` |
| `Badge` | `Default`, `Secondary`, `Outline`, `Success`, `Info`, `Accent` (coral), `Destructive` |
| `Card` | Ink surface + optional `elevated` keyboard-key shadow |
| `Dialog` | Overlay + key-elevated panel (create task, inspector) |
| `Input` / `Textarea` / `Select` | Recessed wells (`rgba(255,255,255,0.05)`) |
| `Tabs` / `TabsList` / `TabsTrigger` | Filter strip on Tasks view |
| `Label` / `Separator` / `Kbd` | Form labels, dividers, shortcut caps |

Primary actions never use chromatic fills — Mist on Void is the only filled CTA.
