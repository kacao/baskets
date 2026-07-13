# ADR — Baskets

Architecture decisions as a current-state digest — the **decision + why**, not the implementation (that's AGENTS.md + the code) and not the history (that's git). Only final decisions are kept; superseded ones are folded into their successor. Topic → originating ADR(s) in parentheses.

---

## Stack, build & data (ADR-001/002/021/025/050)

- **SvelteKit monolith** (`adapter-node`), no client data layer: mutations are **form actions**, pages use server `load` — progressive enhancement + validation co-located with mutations.
- **Multi-dialect DB via Drizzle (ADR-050)**: **SQLite (default, better-sqlite3) + Postgres (postgres-js)**, chosen by `DB_DIALECT` (`DATABASE_URL` = file path or `postgres://…`). **Per-dialect schema files** — `schema.sqlite.ts` (canonical) + `schema.pg.ts` (byte-identical table/column _names_, only types differ) behind a `schema.ts` **facade** that casts PG onto the sqlite types so all importers keep one shape. Schema applied via `drizzle-kit push` — **no migration files**. **Rule: edit both schema files in lockstep.** MySQL deferred (needs a `.returning()`/upsert shim + varchar PKs).
- **Prod runs a custom `server.js`** (adapter-node handler + realtime `/ws` upgrade) as one Node process; `npm start` runs it, not `build/index.js`.
- **`withTransaction` dialect-safe atomicity primitive (ADR-057)**: better-sqlite3's `db.transaction(fn)` needs a **synchronous** callback returning `T` directly, incompatible with the async service layer; postgres-js's `transaction` is properly async. `withTransaction` picks per `DIALECT` — pg uses its native async `transaction`; sqlite issues a manual `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` on the shared connection (fine for single-tenant, low-concurrency use — not safe for overlapping concurrent transactions on one connection). **Rule: only DB writes go inside the callback — fire-and-forget side effects (`dispatchEvent`, `broadcastProjectChange`, `notifyMentions`, `logActivity`, `createNotification`) run in the caller after it resolves.** So far only `updateTaskService` (custom-field write + task update + completing-cascade) is wrapped; `bulkUpdateTasks`/`moveTaskService`/`setTaskStatusService`/`createTaskService` remain sequential (follow-ons).

---

## Auth, API & access control (ADR-003/005/006/013/017/019/036/039/048/049)

- **BetterAuth** (TOTP + admin plugins, Drizzle adapter, auth tables in app schema); `hooks.server.ts` populates `locals.user`/`session`. **Explicit policy (ADR-048)**: 12-char password floor, 14-day sessions, prod-only rate limit; seed passwords from `SEED_*` env vars.
- **REST API** with **dual auth** (session cookie OR `Bearer bsk_…` — 256-bit, SHA-256 hash, plaintext shown once).
- **Single tenant**; **workspaces are the org + sharing primitive** — every project belongs to one (owner); statuses + labels are workspace-scoped. Empty-only deletion; last workspace undeletable.
- **Visibility = access (ADR-019)**: admins see all; others see workspaces they own/are granted + directly-granted projects. **Inaccessible reads → 404** (no existence oracle), not 403 — including missing-project sub-resource GETs (the admin short-circuit still loads the row first). Guard reads with `canAccessProject`; filter lists by accessible ids. Non-admins have no read-only tier yet (`canAccessProject ≡ canEditProject`).
- **Edit rights**: task editing needs project **access**; **structure edits** (workspace/project/view/status/milestone/label/location meta) need admin / workspace owner / a `permission` grant. Cascade: workspace ⇒ projects ⇒ views; view grants don't confer visibility.
- **One service layer, thin adapters (ADR-049)**: each domain has a service module (`src/lib/server/{tasks,statuses,labels,milestones,views,customFields,comments}.ts`) owning all validation, permission guards, writes, and side-effects (broadcast, notifyMentions, activity, recurrence, cascade), returning a discriminated `ServiceResult<T>`. Form actions and REST endpoints are **thin adapters** differing only in input parsing (FormData vs JSON) + response shaping. Full UI→REST parity (ADR-036); secrets (key hash, `storagePath`) never returned; Integrations + auth/2FA excluded. **Rule: a new mutation gets a service fn + adapters — never a second copy of the logic.** Keep `static/llms.txt` current.
- **Export/import (ADR-039)**: JSON/CSV export (status by name); import is web-only, creates a NEW project with id-remapping, **lossy by design**. Superseded the removed **saved filters** (per-view `view.config.filters` persists instead).

---

## Domain model (ADR-010/011/014/015/024/029/031/037/043/045)

- **Tasks**: one nesting level (depth 1, enforced). Parent → `done` cascades to subs; deleting a parent deletes subs.
- **Statuses**: table-driven, behavior keys off `status.category` (`backlog|planned|in-progress|completed|canceled`) **never the name**. Three scopes: five fixed app-wide built-ins (name/category fixed, icon editable), workspace-scoped, project-scoped; `project_status` whitelists per project. Optional color/icon/description. **Status editor (ADR-029)** is category-grouped, drag-reorder within a category; built-ins + inherited render read-only.
- **Milestones / labels / dependencies** are plain join tables; all dependencies are **informational** ("blocked by"), never gating status. A label is EITHER workspace-scoped (shared pool, opted onto projects) OR project-scoped; optional color + icon.
- **Locations**: project-scoped, coords optional; legacy `task.location` text kept as a map fallback.
- **Custom fields (ADR-031)**: project-scoped typed fields on **tasks OR the project**; types incl. select/person/files/task/place/**rollup**. **One TEXT value per `(task,field)`** (scalar or JSON id-array for multi-capable types) over typed columns/row-per-value — preserves order, one-query load. Config is schemaless JSON, name unique per (project,entity), **type immutable after create**, **`appliesTo`** gates task levels. **v1 display-only** (no sort/group/filter by them); formula/button deferred via type+config. All writes funnel through one validated path (no cross-project refs).
- **Number rollup-to-parent (ADR-043)**: a `number` field can show a **parent's value as the aggregate of its sub-tasks'** values for the same field — **display-only, never stored**; aggregations skip a parent's stale stored value to avoid double-counting.
- **Collapsible sections (ADR-045)**: multi-value field pills, plus the **Sub-tasks** (`__subtasks`) and **Description** (`__description`) sections, collapse via one localStorage mechanism keyed **per container** (task id / project id). Multi fields + Sub-tasks default **collapsed** (Sub-tasks auto-expands on first add, ADR-056); Description defaults **expanded**. Pure client UI state.
- **Files (ADR-031)**: uploads on **local disk** (gitignored), `storagePath` never exposed. Served only via an access-gated streaming endpoint with `nosniff` + CSP `sandbox`, **server-derived MIME**, and an exec/markup denylist — prevents stored-XSS from our origin.
- **Views**: per-project `view` rows with **schemaless `config` JSON**; multiple views per type. Map (Leaflet) and **Flow (ADR-037, Svelte Flow)** are **client-only** (dynamic import in `onMount`) so the libs never run at SSR; Flow uses a hand-rolled longest-path layout (no dagre dep). Display-only.
- **Start/due dates** on task/milestone/project — optional, informational.

---

## Project page & editing UX (ADR-012/020/023/024/027/030/041/044/046/054/055/056)

- **Project header portaled into the shell topbar (ADR-044)** via a shared `portal` action — a portaled node keeps its Svelte identity + scoped styles, only its DOM parent moves. **Hidden until portaled** (the action stamps `data-portaled`; `.proj-topbar` is `display:none` until then) so it never flashes in its SSR position on hydration (ADR-055).
- **Project header** = title/icon/pin + a "…" editor menu (Create / Status / Icon / Labels / Milestones / Delete). Board column quick-add + focused **New-task/New-milestone panes** (ADR-027; "Create more" carries fields forward) are the creation affordances. **Header chips** show the project's own custom fields as kv-pills (which/order via `project.chipFields`, ADR-041).
- **One shared SidePane** for the task/Customize/Milestones panes; `use:portal` makes it an **in-flow flex sibling of `.content`** so opening it scrolls content rather than reflowing children. Resizable, persisted width; full-width overlay <900px (full-screen sheet above the topbar on phones, ADR-053). **Exactly one pane open at a time** (registry).
- **Task pane**: full-width Title; a **pills row** (each a reusable `Popover`; `patchTask` updates only fields present — no clobber); a **collapsible Description** (borderless, document-like editor); a **collapsible Sub-tasks** section (default collapsed, auto-expands on first add, header "+"). Date pills open a **custom `DatePicker` calendar** (no native `<input type=date>`); number custom fields have −/+ steppers + a currency affix + right-aligned tabular figures (ADR-056).
- **URL-addressable panes (ADR-054/055)**: the open pane is reflected in the URL (`?task=` in the 6 views, `?pane=…` on the project page) via **SvelteKit shallow routing** through `src/lib/paneUrl.ts` (`replaceState`, so `load()` doesn't re-run; **not** `pushState`, so in-pane nav doesn't fill history). **Rules:** write with `setPaneUrl` (based on `window.location`, since shallow routing leaves `page.url` stale); **read with `readPaneParam`** (returns `window.location`'s value but touches `page.url` so back/forward still re-trigger) — reading `page.url.searchParams` directly lets an `invalidateAll()` re-run the read-effect with the stale URL and close the pane; read any URL↔state sentinel via `untrack`.
- **Escape & effect hygiene (ADR-055)**: modals/popovers that can open over the pane stop Escape in the **capture phase** (so it dismisses them, not the pane behind); `ConfirmModal` scopes Enter-confirm to the dialog (no danger-delete from a background field). Effects seeding local state from `page.data`-derived props (e.g. `CustomFieldValue`'s one-way-bound editor) **guard on identity/value** so `invalidateAll` churn can't reset an in-progress edit.
- **Overview & Files pages (ADR-046)**: two per-project routes with **independent loads gated by `canAccessProject`→404** (not the settings `canEditProject`/403) so non-editors get read-only. Overview = borderless document-like title+description (reuses the settings `updateProject`, patch-style for dates). Files = aggregates every project file (task attachments + cf uploads + project-level) via `GET`/`POST /api/projects/{id}/files` (project file = `taskId`+`fieldId` null; same validation as `POST /api/files`).
- **Table** keeps column widths (content pane scrolls instead of squishing); **resizable columns** persist to `config.colWidths` (→ `table-layout: fixed`). **Group by** shared across Table/List; Board adds swimlanes. TableView uses **one `<table>`** so columns align across all groups (ADR-030). Per-view **Customize** pane holds status-display / hide-empty-groups / columns (ADR-041).
- **No decorative glyphs** before entity names (a `⛓ N` blocker _count_ is fine).

---

## Realtime collaboration (ADR-025)

Native **WebSockets** on `/ws`; transport is **plain-ESM** (no `$lib`/TS) so it's shared by the Vite dev plugin + prod `server.js` and imports no app modules. **Sync = invalidate + refetch** (not OT): a mutation fire-and-forget broadcasts a project-changed ping, clients debounce `invalidateAll()` — reuses every `load()` permission filter, no delta protocol; concurrent edits are last-write-wins. Upgrade/subscribe auth by forwarding cookies to the app's own `/api/me` + `/api/projects/{id}`. Presence avatars via heartbeat.

---

## Cross-cutting (ADR-007/008/016/018/022/027/028/034/038/040/042/052/053)

- **Theming**: Tailwind 4 + DaisyUI 5 (light/dark); a **token bridge** maps legacy `--color-*`/`--sp-*` vars onto DaisyUI tokens so scoped `<style>` blocks follow the theme. Theme via `theme` cookie at SSR. No focus rings.
- **High contrast (ADR-038)**: a **separate axis** from light/dark (`contrast` cookie) overriding tokens to black/white + squaring large surfaces (scoped CSS, not token-zeroing).
- **Tooltips (ADR-034)**: a `use:tooltip` action over **one shared singleton node**; strips the host's native `title` to avoid an OS double.
- **ColorPicker (ADR-040)**: structural twin of IconPicker — controlled `{value,onSelect,onRemove}`, caller owns persistence; emits 6-digit `#rrggbb`. Replaces raw `<input type=color>`.
- **Icons (ADR-052, was iconoir/ADR-028)**: **Heroicons** (24px outline) via a generated **external SVG sprite** (`scripts/build-heroicons-sprite.mjs`) that also emits **alias symbols** for the ~60 legacy iconoir tokens still hardcoded, so existing `<Icon name>` call sites render Heroicons unchanged. Stored entity icons keep the `iconoir:` prefix as a namespace (a picked Heroicon is stored `iconoir:<heroicon-name>` — no data migration). **Rule: new icons use Heroicon names; reuse a legacy token only by adding it to `ALIASES`.**
- **Motion**: no animation library — `svelte/transition` + CSS, ≤200ms; `prefers-reduced-motion` kills all motion.
- **Toasts / Confirm modal (ADR-027)**: tiny app-wide primitives (`toast()`, `confirmDialog()→Promise<boolean>`) mounted once in the shell; the modal replaces native `confirm()`. Destructive confirms use enhance's `cancel()` (never `onsubmit`+`preventDefault`).
- **i18n**: hand-rolled, English strings **are** the keys (passthrough); `$t` + `registerDictionary` kept so a locale can be re-added. DB content never translated.
- **Integrations**: `dispatchEvent` fire-and-forget (never throws) after mutations; one row per type. Slack = incoming webhook (URL allow-listed, stored server-side, never re-exposed).
- **Touch / mobile (ADR-042/053)**: native HTML5 DnD + `oncontextmenu` are mouse-only → two in-house **pointer-event** primitives replace them (`use:sortable` — touch engages after a still hold so swipes still scroll; `use:longpress` — fires the same handler as `oncontextmenu`). **Rule: don't reintroduce `draggable` for new reorder UI.** Mobile pass (ADR-053): `viewport-fit=cover` + `env(safe-area-inset-*)` on fixed/edge UI, 16px inputs to kill iOS zoom-on-focus, full-screen task sheet above the topbar, hover flyouts become click accordions on touch. **Rule: any new hover-revealed control on a tap target needs the `@media (hover:none)` neutralization** (the iOS "2-tap" bug).
- **`static/llms.txt`** documents the REST API for agents — keep current on any REST/status/view change.

---

## Essential features batch (ADR-032/035)

Twelve features shipped together **schema-first** (all columns/tables in one `drizzle-kit push`, then built as new files + thin wiring): search/filter, comments+activity, notifications, timeline/calendar views, bulk actions, templates+recurring, CSV export, photo capture, mobile.

- **Filter facets are inclusion sets (ADR-035)**: each `view.config.filters` array holds the **CHECKED (shown)** values and filters **only when its key is present** — absent = inactive (all shown). New views start all-checked; an empty present array shows nothing. Search also matches custom-field values resolved to labels.
- **Removed**: **Budget** (cost rollup — general per-group **Aggregations** remain) and **saved filters** (superseded by `view.config.filters`).
- Recurring tasks spawn the next occurrence on completion (board drag-to-complete doesn't yet — follow-up).

---

## "@" inline-token references (ADR-047/051)

- **Storage = inline tokens, no schema change**: `@[label](kind:id)` lives in the existing plain-text columns (`task.description`/`comment.body`/`project.description`); `label` is denormalized as a delete fallback. Kinds: task/location/file/project/person, plus **`field` (ADR-051)** — references one of the OWNING task's own custom fields and renders a display-only `[name | live value]` chip (resolved at render time; never notifies). Parsing in `src/lib/mentions.ts` (client+server safe, tolerant).
- **Rendering = `RichText.svelte`** — tokenizes to text spans + real chips (**no `{@html}`**; labels interpolated, no stored-XSS; dangling ids degrade to a muted label). Also **auto-links bare URLs** via `linkify()` (http(s)/`www.`/email → real `<a target=_blank rel=noopener>`, hrefs restricted to http(s)/mailto). Editing = **`MentionEditor.svelte`**, a contenteditable that shows inline pills while typing, serializes DOM→token on input, and anchors the caret via the native Selection API.
- **Server (`notifyMentions`)**: notifies only **newly-mentioned** `person:` refs, not the actor, and **only project-accessible users** (`person:<id>` is attacker-controlled text — a hand-typed token can't notify/leak to arbitrary users). Hooked into `patchTask`, comment POST/PATCH, and `updateProject`.
