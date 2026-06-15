# PRD — Baskets

Single-instance project management app: workspaces → projects → tasks → sub-tasks. Linear/Notion-inspired, deliberately small. This document describes the product as currently built and its near-term direction.

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
- CRUD with name (≤120), optional description, an optional emoji **icon**, an optional project **status**, and a **pin** (pinned projects sort first, marked ✦). Belong to a workspace; creating a project requires edit rights on that workspace.
- Projects list with task counts and a done-progress bar; project cards show the icon and (when multiple) the workspace.
- Project page header has a "…" menu (editors): Edit project…, Pin/Unpin, Status, Icon (emoji picker), Labels, Delete.
- Per-project: labels (workspace pool), dependencies on other projects (cycle-checked), eligible statuses, milestones.

### Views
- Each project has ≥1 visible view; types: **table**, **board**, **list**, **dashboard**, **map**. New projects start with a Table view.
- Multiple views per type allowed. The "+" (revealed on viewbar hover) adds a view or re-enables a hidden one. Right-click a view tab → Rename, Display as (text / text+icon / icon only), Edit view, Duplicate, Delete; Hide (keeps config) lives in the edit pane. A project must keep ≥1 visible view.
- **Table** renders a real table with column headers; a "…" header menu shows/hides optional columns (Priority/Assignee/Milestone/Due/Labels), persisted to view config; a leading chevron expands sub-tasks; rows expand to an inline detail/edit panel; empty state has a "+" that opens a new-task dialog.
- Board groups by status with drag-and-drop + split task panel; list ranks by the `order` field; dashboard shows stats; map plots `lat, lng` tasks on OpenStreetMap (Leaflet).

### Tasks
- Fields: title (≤240), description, status (project's eligible statuses), priority (`none|low|medium|high|urgent`), assignee, milestone (same project), labels, due date, location, position, optional `order` rank.
- One level of nesting; sub-tasks can't have children (enforced). Completing a `done`-category parent completes its sub-tasks.
- Dependencies: task→task within a project, sub-task→sibling; cycle-checked; informational ("blocked by").

### Statuses
- Three scopes: **app-wide defaults** = exactly five fixed built-ins (Backlog, Planned, In progress, Completed, Canceled) — no add/edit/remove (/settings/statuses is a read-only admin reference); **workspace** statuses (workspace settings); **project** statuses (project settings). Behavior keys off the category (`todo|active|done|canceled`), never the name.
- Each status has an optional **color**; the task status picker is a colored pill that opens a popover, and statuses show as colored dots/pills throughout.

### Labels
- Workspace-scoped (managed in workspace settings; optional groups). Attachable to projects and tasks within the workspace.

### REST API
- `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`
- `GET (?projectId=)/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id`
- Auth: session cookie or `Authorization: Bearer bsk_…` API key. JSON errors `{ "error": "…" }`. Visibility-filtered (inaccessible → 404).
- `/llms.txt` documents the API for agents.

### API keys
- Per-user, created/revoked in /settings; named, prefix shown, last-used tracked. Plaintext shown once; SHA-256 hash stored. Authenticates as its owner.

### Integrations
- /integrations; one config per type (single instance). **Slack** incoming-webhook notifications on `project.created`, `task.created`, `task.completed` (connect, pause/resume, test, remove). Fire-and-forget — failures never block app mutations.

### Design
- Built on **Tailwind 4 + DaisyUI 5** (ADR-022). Stock **light** (default) and **dark** themes with a topbar toggle (cookie-persisted, SSR-applied). Animations ≤200ms, reduced-motion safe. (`design.md` describes the retired StudioBlank look and is historical.)

### Other
- English-only UI (the `$t()` wrapper remains so a locale can be re-added). Responsive with a mobile sidebar drawer. Admin → Users: create, toggle admin, ban/unban, remove.

## Non-goals

- Multi-tenant SaaS (billing, org isolation) — this is one self-hosted instance, access-scoped by workspaces
- Real-time collaboration / live presence
- Mobile native apps (responsive web only)
- Time tracking, Gantt/roadmap views, custom fields

## Future candidates

- More integrations (generic outgoing webhooks, GitHub/Linear sync) and events (`task.updated`, assignment notifications)
- Moving a project between workspaces
- API pagination + rate limiting before any public deployment
- Test suite (currently `npm run check` + manual smoke tests)

## Success criteria

- A new user can create a workspace, a project, and add tasks in under a minute.
- A script holding an API key can drive the full project/task lifecycle via REST.
- A task state change reaches the configured Slack channel within seconds, and Slack being down has zero effect on the app.
