# ADR — Baskets

Architecture decision records. One section per decision; status reflects current state.

---

## ADR-001: SvelteKit monolith with server-side form actions

**Status:** Accepted

**Context:** Small single-tenant app; one developer; no need for a separate API tier for the UI.

**Decision:** Single SvelteKit app (adapter-node). UI mutations use form actions in `+page.server.ts`; pages load data in server `load` functions. No client-side data layer.

**Consequences:** Progressive enhancement for free, minimal client JS, validation co-located with mutations. Programmatic access is handled separately (ADR-005) — form actions are not an API surface.

---

## ADR-002: SQLite via better-sqlite3 + Drizzle ORM

**Status:** Accepted

**Context:** Single-tenant, single-node deployment; data volume is small; ops simplicity is a priority.

**Decision:** SQLite file database (`DATABASE_URL`, default `./baskets.db`) accessed synchronously via better-sqlite3, with Drizzle ORM for schema (`src/lib/server/db/schema.ts`) and queries. Schema changes apply via `drizzle-kit push` rather than migration files.

**Consequences:** Zero-infrastructure deploys and trivial backups. Sync driver is acceptable at this scale. No migration history — `db:push` is destructive-change-blind, fine for this project, would need revisiting for multi-instance or managed deployments. Parameterization handled by Drizzle.

---

## ADR-003: BetterAuth for authentication

**Status:** Accepted

**Context:** Need email/password auth, TOTP 2FA, and basic user administration without building it.

**Decision:** BetterAuth with `twoFactor` and `admin` plugins, Drizzle adapter, auth tables co-located in the app schema. `hooks.server.ts` populates `locals.user`/`locals.session` per request. Client-side auth actions go through `authClient` (`src/lib/auth-client.ts`).

**Consequences:** Auth tables must track BetterAuth's expected fields across upgrades (add column + `db:push` when it complains). Seed script must mirror the auth config.

---

## ADR-004: Single tenant, two roles

**Status:** Partially superseded by ADR-013 (edit rights are now grant-based; single-tenant reads and the admin role remain)

**Context:** Product is for one team sharing one instance.

**Decision:** No workspaces or per-project ACLs. All signed-in users see and edit everything; the only privilege boundary is `user.role === 'admin'` for /admin.

**Consequences:** Authorization checks are uniformly "signed in?" (plus admin gate). Massive simplification of every query and endpoint. Multi-tenancy would be a rewrite-level change — explicitly out of scope (see PRD non-goals).

---

## ADR-005: REST API as separate `/api` routes, dual auth

**Status:** Accepted

**Context:** Programmatic access needed (scripts, CI, future integrations) without disturbing the form-action UI layer.

**Decision:** Dedicated `+server.ts` endpoints under `src/routes/api/{projects,tasks}` returning JSON, accepting either the browser session cookie or a bearer API key. Validation rules duplicated from form actions via shared constants/helpers in `src/lib/server/api.ts`; errors are `{ error }` JSON with proper status codes.

**Consequences:** Two mutation paths (form action + REST) must stay behaviorally in sync (e.g., parent-done-cascades rule lives in both). Acceptable duplication at current size; extract shared service functions if a third surface appears.

---

## ADR-006: Custom API keys (hash-stored) instead of BetterAuth apiKey plugin

**Status:** Accepted

**Context:** REST needed `Authorization: Bearer` auth. BetterAuth ships an apiKey plugin, but its header conventions, table shape, and version coupling add surface we don't control.

**Decision:** Own implementation: `api_key` table (name, displayable prefix, SHA-256 hash, owner, last-used), `bsk_`-prefixed 256-bit random tokens, plaintext shown once. `src/lib/server/api-keys.ts` generates/resolves; `hooks.server.ts` resolves `Bearer bsk_…` into `locals.user` before session lookup and rejects banned users.

**Consequences:** ~60 lines we fully own; no plugin version risk. Unsalted fast hash is appropriate because tokens are high-entropy random (nothing brute-forceable). Keys inherit the owner's privileges — no scoped keys until a real need appears.

---

## ADR-007: Integration events are fire-and-forget

**Status:** Accepted

**Context:** Slack (and future integrations) must never make task/project mutations slow or failing.

**Decision:** `dispatchEvent(event)` in `src/lib/server/integrations/` is called un-awaited (`void dispatchEvent(...)`) after mutations. It catches all errors internally, applies a 5s timeout to outbound webhooks, and logs failures. One `integration` row per type; config is JSON per type.

**Consequences:** At-most-once delivery; a lost notification is acceptable, a blocked mutation is not. No retry queue until something needs it. New integrations: add a module + a case in `dispatchEvent`.

---

## ADR-008: Slack webhook URL validated and never re-exposed

**Status:** Accepted

**Context:** Webhook URLs are capability secrets and an SSRF vector if user-supplied URLs are fetched server-side.

**Decision:** URL must start with `https://hooks.slack.com/`; stored server-side only; the client gets a masked hint (last 8 chars). Test-message action exercises the stored URL without revealing it.

**Consequences:** No arbitrary-URL fetches from the integrations form. Generic outgoing webhooks (future) will need their own allowlisting/egress policy decision.

---

## ADR-009: Token-only theming, one design-system source of truth

**Status:** Accepted (supersedes the original RawBlock theme)

**Context:** Visual identity should be swappable without touching components; the app has already switched RawBlock → StudioBlank once.

**Decision:** Every visual primitive (colors, type scale/weights/transforms, borders, spacing, motion) is a CSS variable defined per `[data-theme]` block in `src/app.css`. Components consume tokens only. Active theme set by one attribute in `src/app.html`. `design.md` documents the active system; superseded specs are kept as `.bak` files.

**Consequences:** The RawBlock→StudioBlank migration proved the model: theme swap = new token block + attribute flip, with component edits only where old styles had cheated (hardcoded values). Token set is the contract; new components must not bypass it.

---

## ADR-010: One level of task nesting

**Status:** Accepted

**Context:** Sub-tasks add value; arbitrary trees add UI and query complexity disproportionate to this product's scope.

**Decision:** `task.parentId` self-reference, max depth 1, enforced at creation in both the form action and the REST endpoint. Parent completion cascades to children; deleting a parent deletes children first.

**Consequences:** Flat queries, simple UI. If deeper hierarchies are ever needed, this becomes a recursive structure with closure-table or CTE queries — a deliberate future decision, not an accident.

---

## ADR-011: Table-driven statuses with behavior categories

**Status:** Accepted (supersedes the hardcoded `todo | in_progress | done` enum)

**Context:** Statuses must be customizable app-wide (Settings → Statuses) and selectable per project. App logic (done-cascade, progress, strikethrough) must not depend on user-editable names.

**Decision:** `status` table with a `category` column (`todo | active | done | canceled`) driving all behavior; names are display-only. Five built-ins (Backlog, Planned, In progress, Completed, Canceled) are bootstrapped idempotently at server start (`ensureDefaultStatuses`) and cannot be deleted; custom statuses can't be deleted while in use. `project_status` join table whitelists statuses per project; `task.statusId` is an FK. REST accepts `statusId` or case-insensitive `status` name.

**Consequences:** Renames are free; behavior keys off category only. Status management is admin-only. The REST contract changed from fixed strings to names/ids (breaking; acceptable pre-release).

---

## ADR-012: Notion-style project views, config as JSON

**Status:** Accepted

**Context:** Projects need multiple views (dashboard, table, board, map) with per-view configuration and edit/normal modes.

**Decision:** `view` table per project (`type`, `config` JSON, `isDefault`). Invariants: every project gets a default Table view at creation; the last view can't be deleted. Active view selected via `?view=` query param. Config is type-specific and intentionally schemaless JSON (table: visible columns + status filter); unknown keys are ignored. One Svelte component per view type under `src/lib/components/views/`.

**Consequences:** New view types = new component + enum entry; config migrations are unnecessary because readers treat config as optional hints. Board has no drag-and-drop yet (status changed via inline select) — revisit if demand appears.

---

## ADR-013: Grant-based edit permissions, read stays open

**Status:** Accepted (supersedes "all members edit everything" from ADR-004)

**Context:** Requirement: admins edit views and grant edit rights to users for specific projects, views, and tasks.

**Decision:** Single `permission` table of edit grants (`userId`, `resourceType: project|view|task`, `resourceId`). Reads remain open to all signed-in users (single tenant). Resolution cascades: project grant ⇒ everything inside; parent-task grant ⇒ its sub-tasks; view grant ⇒ that view's config. Admins bypass. Non-admin project creators get an automatic grant on their own project. Grant management is admin-only, done in the project Edit panel. Enforced in form actions AND REST.

**Consequences:** Non-admin users are read-only by default until granted. No "viewer/commenter" levels — single `edit` level until needed. Permission checks add one indexed query per mutation.

---

## ADR-014: Milestones, labels, dependencies as plain join tables

**Status:** Accepted

**Context:** Milestones (per project, assignable to its tasks), labels (app-wide, optionally grouped, attachable to projects and tasks), dependencies (project→project, task→task same project, sub-task→sibling sub-task).

**Decision:** `milestone` (+ `task.milestoneId` FK, same-project validated), `label`/`label_group` (group optional, `set null` on group delete) with `project_label`/`task_label` joins, `project_dependency`/`task_dependency` composite-PK joins. Dependency rules enforced server-side: same-project, sub-tasks only on siblings, cycle-checked with DFS before insert. Dependencies are informational (displayed as "blocked by") — they do not gate status changes.

**Consequences:** All flat, indexable, cascade-deleting structures. Blocking semantics (can't complete while blocked) is a future product decision, not a schema change.

---

## ADR-015: Map view via Leaflet + OpenStreetMap, coordinates only

**Status:** Accepted

**Context:** "Map" is a required view type but tasks had no geodata; geocoding services add keys/cost/SSRF surface.

**Decision:** `task.location` stores raw `"lat, lng"` (validated by regex). Map view lazy-imports Leaflet client-side (`onMount`), renders OSM tiles and `circleMarker`s (no icon assets), fits bounds. No geocoding — users enter coordinates.

**Consequences:** Only dependency added is `leaflet`; SSR untouched. Address-based input would need a geocoding decision later.
