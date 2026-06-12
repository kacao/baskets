# PRD — Baskets

Single-tenant project management app: projects → tasks → sub-tasks. Linear/Notion-inspired, deliberately small. This document describes the product as currently built and its near-term direction.

## Problem

Small teams that share one workspace need a fast, no-ceremony way to track projects and tasks without the overhead of full-featured PM suites (workspaces, permissions matrices, billing tiers). One instance, one team, everyone sees everything.

## Users

- **Member** — any signed-in user. Sees everything and works tasks everywhere (create, edit, move, status, labels, dependencies). Project/view structure is editable only where they hold a grant (creators get one on their own projects).
- **Admin** — edits everything, manages users (/admin), customizes statuses and labels, grants/revokes edit permissions.

Single tenant: reads and task work are open to all signed-in users. Structure (project meta/delete, views, eligible statuses, milestones) is gated: admins, plus per-project or per-view grants.

## Core features (shipped)

### Authentication
- Email/password sign-up and sign-in (BetterAuth).
- Optional TOTP two-factor with QR enrollment and one-time backup codes (managed in /settings).
- Admin plugin: roles, banning, user administration at /admin (admin role required).

### Projects
- CRUD with name (≤120 chars) and optional description.
- Projects list with task counts and done-progress bar.
- Sidebar lists all projects under the "Projects" menu item for one-click navigation.
- Labels (shared label pool), dependencies on other projects (cycle-checked), per-project eligible statuses, milestones.

### Views
- Each project has 1+ views; types: **table**, **board**, **list**, **dashboard**, **map** (Notion-style tabs). Default view is Table, created automatically; the last view cannot be deleted.
- Normal mode renders the view; edit mode (permitted users) renames, retypes, configures (table: visible columns + status filter), or deletes it.
- Board groups by status with drag-and-drop; list shows all tasks ranked by their `order` field (unranked last) with expandable sub-task rows; dashboard shows progress/status/milestone stats; map plots tasks with a `lat, lng` location on OpenStreetMap.

### Tasks
- Belong to a project; fields: title (≤240), description, status (from the project's eligible statuses), priority (`none | low | medium | high | urgent`), assignee, milestone (same project), labels, due date, location, position, and an optional `order` rank (null = unranked) used by list views.
- One level of nesting: a task may have sub-tasks; sub-tasks cannot have children (enforced server-side).
- Completing a parent task (status with category `done`) completes its sub-tasks.
- Dependencies: task→task within a project, sub-task→sibling sub-task; cycle-checked; shown as "blocked by" (informational).

### Statuses
- App-wide pool, customizable at Settings → Statuses (admin): five built-ins (Backlog, Planned, In progress, Completed, Canceled) plus custom ones, each with a behavior category (`todo | active | done | canceled`).
- Each project selects which statuses its tasks may use.

### Labels
- App-wide labels managed at Settings → Labels (admin); optional label groups. Attachable to projects and tasks.

### Permissions
- Read + task editing: every signed-in user. Structure editing: admins, plus users holding admin-granted edit permissions on a project or a view.

### REST API
- `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`
- `GET (?projectId=)/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id`
- Auth: session cookie or `Authorization: Bearer bsk_…` API key.
- JSON error shape: `{ "error": "message" }` with appropriate HTTP status.

### API keys
- Per-user, created/revoked in /settings. Named, prefix shown for identification, last-used tracking.
- Plaintext shown exactly once at creation; only a SHA-256 hash is stored.
- A key authenticates as its owning user.

### Integrations
- Managed at /integrations; one configuration per integration type (single tenant).
- **Slack** (shipped): incoming-webhook notifications on `project.created`, `task.created`, `task.completed`. Connect, pause/resume, test message, remove.
- Dispatch is fire-and-forget: integration failures never block or fail app mutations.

### Design
- StudioBlank ultra-minimal design system (`design.md` is the visual source of truth): monochrome, Inter weight contrast, 1px hairlines, whitespace-first, no radius/shadows.
- Fully token-driven theming; themes switch via one `data-theme` attribute.

## Non-goals

- Multi-tenancy, workspaces, per-project permissions
- Real-time collaboration / live presence
- Mobile native apps (responsive web only)
- Time tracking, Gantt/roadmap views, custom fields

## Future candidates

- More integrations (generic outgoing webhooks, GitHub/Linear sync)
- More events (`task.updated`, `project.deleted`, assignment notifications)
- API pagination + rate limiting (current dataset sizes make this a non-issue; revisit before any public deployment)
- Test suite (currently `npm run check` + manual smoke tests)

## Success criteria

- A new user can sign up, create a project, and add tasks in under a minute.
- A script holding an API key can drive the full project/task lifecycle via REST.
- A task state change reaches the configured Slack channel within seconds, and Slack being down has zero effect on the app.
