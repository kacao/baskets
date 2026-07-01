# PRD — Baskets

Single-instance project management app: workspaces → projects → tasks → sub-tasks. Deliberately small. This document describes the product as currently built and its near-term direction.

## Problem

Small teams need a fast, no-ceremony way to track projects and tasks without the overhead of full PM suites (billing tiers, permission matrices). One self-hosted instance; people organize work into workspaces and share by ownership/grants.

## Users

- **Member** — any signed-in user. Sees the workspaces they own or were granted (plus directly granted projects) and works tasks in any project they can access (create, edit, move, status, labels, dependencies). Can create their own workspaces and projects.
- **Workspace owner** — owns a workspace; edits its structure (statuses, labels, projects) and grants others access.
- **Admin** — sees and edits everything; manages users (/admin); the five default statuses are fixed even for admins.

Visibility = access (ADR-019): non-admins see only workspaces they own or hold a grant on, plus projects they were directly granted. Inaccessible projects/tasks return 404. Task editing requires project access; structure edits (workspace/project meta, views, eligible statuses, milestones, labels, grants) require admin, workspace owner, or a grant.

## Core features (shipped)

### Authentication
- Email/password sign-up and sign-in (BetterAuth).
- Optional TOTP two-factor with QR enrollment and one-time backup codes (/settings).
- Admin plugin: roles, banning, user administration at /admin.

### Workspaces
- A workspace belongs to a user (owner) and groups projects; it owns its custom statuses and all its labels.
- CRUD at /workspaces; per-workspace settings (/workspaces/:id/settings): general, workspace statuses, labels (+ groups), edit grants, delete (only when empty; the last workspace can't be deleted).
- The sidebar header is a workspace switcher; the sidebar project list is scoped to the current workspace (persisted in a cookie).
- A default workspace is bootstrapped on first run and adopts any pre-existing data.

### Projects
- CRUD with name (≤120), optional description, an optional **icon** (emoji or iconoir), an optional project **status**, optional start/due dates, and a **pin** (pinned projects sort first, marked ✦). Belong to a workspace; creating a project requires edit rights on that workspace.
- Projects list with task counts and a done-progress bar; project cards show the icon and (when multiple) the workspace.
- Each project is a collapsible sidebar menu → **Overview, Tasks, Milestones, Statuses, Labels, Custom fields, Locations, Files, Settings** (each its own route).
- **Overview** — a focused, document-like editor for the project title + description (borderless inputs, auto-save on blur; read-only for non-editors).
- **Files** — aggregates every file in the project (task attachments, custom-field uploads, and direct project uploads) with filename search, type/source filters, grid/list toggle, image preview/lightbox, download, delete, and drag-drop upload.
- Project page header (portaled into the topbar) has a "…" menu (editors): Create task/milestone, Status, Edit project…, Pin/Unpin, Icon, Labels, Milestones…, Delete; project custom-field values render as header chips.
- Per-project: labels (workspace pool + project-scoped), dependencies on other projects (cycle-checked), eligible statuses, milestones, locations, custom fields.

### Views
- Each project has ≥1 visible view; types: **table**, **board**, **list**, **dashboard**, **map**, **timeline**, **calendar**, **flow** (dependency graph). New projects start with a Table view.
- Multiple views per type allowed. The "+" (revealed on viewbar hover) adds a view or re-enables a hidden one. Right-click a view tab → Rename, Display as (text / text+icon / icon only), Edit view, Duplicate, Delete; Hide (keeps config) lives in the edit pane. A project must keep ≥1 visible view.
- **Table** renders a real table with column headers; a "…" header menu shows/hides optional columns (Priority/Assignee/Milestone/Due/Labels), persisted to view config; a leading chevron expands sub-tasks; rows expand to an inline detail/edit panel; empty state has a "+" that opens a new-task dialog.
- Board groups by status with drag-and-drop + split task panel; list ranks by the `order` field; dashboard shows stats; map plots tasks on OpenStreetMap (Leaflet); timeline + calendar lay tasks out by date; flow renders a dependency graph. Table/board/list also support **group-by** and per-view filters; columns are resizable.
- Editing a task opens the shared right-side **pane** (title click in any view); sub-tasks open their own pane. The view tabs sit at the top of the page (no description bar above them).

### Tasks
- Fields: title (≤240), description (with @-references), status (project's eligible statuses), priority (`none|low|medium|high|urgent`), assignee, milestone (same project), labels, start/due dates, location, position, optional `order` rank, recurrence, custom-field values, and attachments.
- One level of nesting; sub-tasks can't have children (enforced). Completing a `done`-category parent completes its sub-tasks.
- Dependencies: task→task within a project, sub-task→sibling; cycle-checked; informational ("blocked by").
- **Comments + activity log** per task; recurring tasks spawn the next occurrence on completion.

### Statuses
- Three scopes: **app-wide defaults** = exactly five fixed built-ins (Backlog, Planned, In progress, Completed, Canceled) — no add/edit/remove (/settings/statuses is a read-only admin reference); **workspace** statuses (workspace settings); **project** statuses (project settings). Behavior keys off the category (`backlog|planned|in-progress|completed|canceled`), never the name.
- Each status has an optional **color**; the task status picker is a colored pill that opens a popover, and statuses show as colored dots/pills throughout.

### Labels
- Workspace-scoped (managed in workspace settings; optional groups) **or** project-scoped. Optional color + icon. Attachable to projects and tasks within the workspace.

### Custom fields
- Project-scoped typed fields on tasks **or** the project itself: text, number, select, date, person, files, task, checkbox, email, phone, place, url, and **rollup** (a computed aggregate). Select options carry color/icon; number fields can roll up to a parent task. Display-only in v1 (no sort/group/filter by custom field). Project-entity field values can render as header chips on the project page.

### Milestones
- Per-project milestones with inline name/description, a done/total **progress bar**, optional start/target dates, **dependencies** (cycle-checked), and drag-to-reorder. Tasks attach to a same-project milestone.

### Locations
- Per-project named places (title required; optional address + lat/lng). Tasks pick a location; map views plot the coordinates.

### References & rich text
- Typing **@** in a task/project description or a comment opens a caret-anchored picker to reference a **Task, Location, File, Project, or Person** (filter by type; create a task/location/file inline when nothing matches). References insert as inline **pills** that render while editing (contenteditable) and as clickable chips when displayed. Bare URLs and emails auto-link. Mentioning a project-accessible person sends them a notification.

### Comments, activity & notifications
- Threaded **comments** + a per-task **activity log**; an in-app **notification bell** for assignments, due-soon/overdue reminders, and mentions.

### Productivity
- Free-text **search** + per-view **filters** (inclusion sets); **bulk actions** (status / assignee / milestone / labels / delete / make-into-tasks); reusable **task templates**; **recurring** tasks; **CSV export**; **photo/document capture** on tasks.

### Files & uploads
- Files live on local disk, served only through an access-gated endpoint (the on-disk path is never exposed); uploaded as task attachments or `files`-type custom-field values. The per-project **Files page** aggregates them all and also accepts direct project-level uploads. 10 MB cap; executable/active-markup extensions blocked; MIME derived server-side from the extension.

### Realtime
- Live **invalidate-and-refetch** updates over WebSockets (`/ws`) + **presence avatars** on the project page. Last-write-wins; no OT/CRDT co-editing.

### REST API
- **Full UI→API parity** (ADR-036): every web-UI mutation has a REST endpoint — projects, tasks (+ `bulk`/`labels`/`dependencies`/`files`/`comments`), workspaces (+ statuses/labels/grants), per-project statuses/labels/milestones/locations/views/custom-fields/**files**, notifications, templates, export, files, keys, me. (Excluded on purpose: integrations + auth/2FA.)
- Auth: session cookie or `Authorization: Bearer bsk_…` API key. JSON errors `{ "error": "…" }`. Visibility-filtered (inaccessible → 404); never returns secrets (key hash, file storage path).
- `/llms.txt` documents the full API for agents — kept current with every REST change.

### API keys
- Per-user, created/revoked in /settings; named, prefix shown, last-used tracked. Plaintext shown once; SHA-256 hash stored. Authenticates as its owner.

### Integrations
- /integrations; one config per type (single instance). **Slack** incoming-webhook notifications on `project.created`, `task.created`, `task.completed` (connect, pause/resume, test, remove). Fire-and-forget — failures never block app mutations.

### Design
- Built on **Tailwind 4 + DaisyUI 5** (ADR-022). Stock **light** (default) and **dark** themes plus a separate **high-contrast** axis — all cookie-persisted, SSR-applied (topbar Appearance menu). **iconoir** icon set throughout. Animations ≤200ms, reduced-motion safe.

### Other
- English-only UI (the `$t()` wrapper remains so a locale can be re-added). Responsive with a mobile sidebar drawer. Admin → Users: create, toggle admin, ban/unban, remove.

## Non-goals

- Multi-tenant SaaS (billing, org isolation) — this is one self-hosted instance, access-scoped by workspaces
- Real-time concurrent co-editing (live invalidate-and-refetch updates + presence avatars exist; OT/CRDT editing does not)
- Mobile native apps (responsive web only)
- Time tracking

## Future candidates

- More integrations (generic outgoing webhooks, GitHub sync) and events (`task.updated`, assignment notifications)
- Moving a project between workspaces
- API pagination + rate limiting before any public deployment
- Broader automated test coverage — a **vitest** unit suite (`tests/unit/`) plus integration/e2e harnesses exist; expand them (e.g. component/DOM tests for the contenteditable mention editor)

## Success criteria

- A new user can create a workspace, a project, and add tasks in under a minute.
- A script holding an API key can drive the full project/task lifecycle via REST.
- A task state change reaches the configured Slack channel within seconds, and Slack being down has zero effect on the app.
