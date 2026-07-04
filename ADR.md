# ADR — Baskets

Architecture decisions as a current-state digest — the **decision + why**, not the implementation (that's AGENTS.md + the code). Per-decision history / superseded records live in git. Topic → originating ADR(s) in parentheses.

---

## Stack, build & data (ADR-001/002/021/025)

- **SvelteKit monolith** (`adapter-node`), no client data layer: mutations are **form actions**, pages use server `load`. Chosen for progressive enhancement + validation co-located with mutations.
- **SQLite (better-sqlite3) + Drizzle**, single schema file, schema applied via `drizzle-kit push` — **no migration files** (destructive-change-blind, acceptable at this scale).
- **Prod runs a custom `server.js`** (adapter-node handler + realtime `/ws` upgrade) as one Node process; `npm start` runs it, not `build/index.js`. Clustering would need pub/sub fan-out.

---

## Auth, API & access control (ADR-003/005/006/013/017/019/036/039)

- **BetterAuth** (TOTP + admin plugins, Drizzle adapter, auth tables in app schema); `hooks.server.ts` populates `locals.user`/`session`.
- **REST API** with **dual auth** (session cookie OR `Bearer bsk_…`). Own API-key impl (SHA-256 hash, plaintext shown once) over a BetterAuth plugin for control.
- **Single tenant**; **workspaces are the org + sharing primitive** — every project belongs to one workspace (owner); custom statuses + labels are workspace-scoped. Empty-only deletion; last workspace undeletable.
- **Visibility = access** (ADR-019): admins see all; others see workspaces they own/are granted + directly-granted projects. **Inaccessible reads return 404** (no existence oracle), not 403. Guard reads with `canAccessProject`; filter lists by accessible ids.
- **Edit rights**: task editing needs project **access**; **structure edits** (workspace/project/view/status/milestone/label/location meta) need admin / workspace owner / a `permission` grant. Cascade: workspace ⇒ projects ⇒ views. View grants don't confer visibility.
- **Full REST parity (ADR-036)**: every UI mutation has a resource-oriented bearer endpoint that **ports logic from the form action** (action stays the behavioral source of truth — duplicated, not yet extracted). Gated per ADR-019; secrets (key hash, `storagePath`) never returned. Excluded on purpose: Integrations (write-only Slack secret) + auth/2FA (BetterAuth's own API). Keep `static/llms.txt` current.
- **Project export/import (ADR-039)**: JSON/CSV export (tasks reference status **by name**); import is web-only, creates a NEW project with full id-remapping. **Lossy by design** (drops assignees, person/file values, attachment bytes, deps, views, grants, label links). Supersedes the removed **saved filters** feature — `view.config.filters` already persists per-view.

---

## Domain model (ADR-010/011/014/015/024/025/029/031/037/043/045)

- **Tasks**: one nesting level (depth 1, enforced). Parent → `done` cascades to subs; deleting a parent deletes subs.
- **Statuses**: table-driven, behavior keys off `status.category` (`backlog|planned|in-progress|completed|canceled`) **never the name**. Three scopes: five fixed app-wide built-ins (name/category fixed, icon editable), workspace-scoped, project-scoped; `project_status` whitelists per project. Optional color/icon/description. **Status editor (ADR-029)** is category-grouped, drag-reorder within a category; built-ins + inherited render read-only.
- **Milestones / labels / dependencies** are plain join tables; all dependencies are **informational** ("blocked by"), they don't gate status.
- **Locations**: project-scoped, coords optional; legacy `task.location` text kept as a map fallback.
- **Custom fields (ADR-031)**: project-scoped typed fields on **tasks OR the project**; types incl. select/person/files/task/place/**rollup**. **One TEXT value per `(task,field)`** (scalar or JSON id-array for multi-capable types) chosen over typed columns/row-per-value — matches the schemaless-JSON instinct, preserves order, one-query load. **Config is schemaless JSON**, name unique per (project,entity), **type immutable after create**, **`appliesTo`** gates task levels. **v1 display-only** (no sort/group/filter by them); formula/button deferred via type+config (no schema change). All writes funnel through one validated path (no cross-project refs).
- **Number rollup-to-parent (ADR-043)**: a `number` field can show a **parent's value as the aggregate of its sub-tasks'** values for the same field — **display-only, never stored** (config-only, no schema change); aggregations skip a parent's stale stored value to avoid double-counting.
- **Collapsible multi-value fields (ADR-045)**: multi-value field pills collapse by default to keep the pane compact; state persists in localStorage **per container** (task id / project id). Sub-tasks section reuses the same mechanism but defaults expanded. Pure client UI state.
- **Files (ADR-031)**: uploads on **local disk** (gitignored), `storagePath` never exposed. Served only via an access-gated streaming endpoint with `nosniff` + CSP `sandbox` and **server-derived MIME** + exec/markup denylist — prevents stored-XSS from our origin.
- **Views**: per-project `view` rows with **schemaless `config` JSON** (keys are optional hints); multiple views per type. Map (Leaflet) and **Flow (ADR-037, Svelte Flow)** are **client-only** (dynamic import in `onMount`) so the libs never run at SSR; Flow uses a hand-rolled longest-path layout (no dagre dep). Display-only.
- **Start/due dates** on task/milestone/project — optional, informational (timeline spans start→due).
- **Labels**: a label is EITHER workspace-scoped (shared pool, opted onto projects) OR project-scoped (owned by one project); optional color + icon.

---

## Project page & editing UX (ADR-012/020/023/024/025/027/030/041/044)

- **Project header portaled into the shell topbar (ADR-044)** via a shared `portal` action (extracted from SidePane) — a portaled node keeps its Svelte identity + scoped styles, only its DOM parent moves. Viewbar stays in `.content`; the redundant "Baskets" brand was removed. (The project description preview was later removed from the board page — it now lives only on the Overview page.)
- **Project header** = title/icon/pin + a "…" editor menu with hover fly-outs (Create / Status / Icon / Labels / Milestones / Delete). Board column quick-add + a focused **New-task/New-milestone pane** are the creation affordances.
- **New-task pane (ADR-027)** with a "Create more" toggle that carries status/milestone/assignee/due to the next task; group "+" prefills the grouping value.
- **One shared SidePane** for the task pane, Customize, and Milestones; `use:portal` makes it an **in-flow flex sibling of `.content`** so opening it scrolls content rather than reflowing children. Resizable, persisted width; full-width overlay under 900px. **Exactly one pane open at a time** (registry).
- **Task pane**: full-width Title + Description (auto-save on blur) with a pills row between them; each pill a reusable `Popover`. `patchTask` updates only the fields present (no clobber).
- **Table** keeps column widths (content pane scrolls instead of squishing); **resizable columns** persist to `config.colWidths` (→ `table-layout: fixed`). **Group by** is shared across Table/List, with Board adding swimlanes. TableView uses **one `<table>`** so columns line up across all groups (ADR-030 — per-group tables misaligned).
- **No decorative glyphs** before entity names (a `⛓ N` blocker *count* is fine).
- **Per-view customization (ADR-041)**: project-wide settings (status display, hide-empty-groups) moved into the per-view **Customize** pane, persisted in `view.config`. Project header **chips** show the project's own custom fields as two-tone kv-pills; which/order via `project.chipFields`.

---

## Realtime collaboration (ADR-025)

Native **WebSockets** on `/ws`; transport is **plain-ESM** (no `$lib`/TS) so it's shared by the Vite dev plugin + prod `server.js` and imports no app modules. **Sync = invalidate + refetch** (not OT): a mutation fire-and-forget broadcasts a project-changed ping, clients debounce `invalidateAll()` — reuses every `load()` permission filter, no delta protocol; concurrent edits are last-write-wins. Upgrade/subscribe auth by forwarding cookies to the app's own `/api/me` + `/api/projects/{id}`. Presence avatars via heartbeat.

---

## Cross-cutting (ADR-007/008/016/018/022/027/028/034/038/040)

- **Theming**: Tailwind 4 + DaisyUI 5 (light/dark); a **token bridge** maps legacy `--color-*`/`--sp-*` vars onto DaisyUI tokens so scoped `<style>` blocks follow the theme. Theme via `theme` cookie at SSR. No focus rings.
- **High contrast (ADR-038)**: a **separate axis** from light/dark (`contrast` cookie) overriding tokens to black/white + squaring large surfaces (scoped CSS, not token-zeroing).
- **Tooltips (ADR-034)**: a `use:tooltip` action over **one shared singleton node** (no N mounted components); strips the host's native `title` to avoid OS double.
- **ColorPicker (ADR-040)**: structural twin of IconPicker — controlled `{value,onSelect,onRemove}`, caller owns persistence; emits 6-digit `#rrggbb` (server parser is 6-digit-only). Replaces raw `<input type=color>`.
- **Motion**: no animation library — `svelte/transition` + CSS, ≤200ms; `prefers-reduced-motion` kills all motion. Destructive confirms use enhance's `cancel()` (never `onsubmit`+`preventDefault`).
- **i18n**: hand-rolled, English strings **are** the keys (passthrough). English-only now, but `$t` + `registerDictionary` kept so a locale can be re-added. DB content never translated.
- **Integrations**: `dispatchEvent` called **fire-and-forget** (never throws) after mutations; one row per type. Slack = incoming webhook (URL allow-listed, stored server-side, never re-exposed — no arbitrary-URL fetches).
- **Icons (ADR-028)**: **iconoir** via a generated **external SVG sprite** (`<use href>`) so page DOM stays light + the sprite caches once. `EntityIcon` renders stored values (`iconoir:<name>` or legacy emoji). Deliberately-custom semantic glyphs (priority bars, board status dots) stay.
- **Toasts / Confirm modal (ADR-027)**: tiny app-wide primitives (`toast()`, `confirmDialog()→Promise<boolean>`) each mounted once in the shell. The confirm modal replaces native `confirm()` (which Chrome anchors top, not center).
- **`static/llms.txt`** documents the REST API for agents — keep current on any REST/status/view change.
- **Touch / mobile (ADR-042)**: native HTML5 DnD + `oncontextmenu` are mouse-only, so two in-house **pointer-event** primitives replace them — `use:sortable` (touch engages after a still hold so swipes still scroll) + `use:longpress` (fires the same handler as `oncontextmenu`). A global touch→DnD polyfill was rejected (would hijack Leaflet/Flow/scroll). Don't reintroduce `draggable` for new reorder UI.

---

## Essential features batch (ADR-032/035)

Twelve features shipped together, **schema-first** (all columns/tables in one `drizzle-kit push`, then built as new files + thin wiring): search/filter, comments+activity, notifications, timeline/calendar views, bulk actions, templates+recurring, CSV export, photo capture, mobile.

- **Filter facets are inclusion sets (ADR-035)**: each `view.config.filters` array holds the **CHECKED (shown)** values and filters **only when its key is present** — absent = inactive (all shown). New views start all-checked; an empty present array shows nothing. Search also matches custom-field values resolved to labels.
- **Removed**: **Budget** (estimated-vs-actual cost rollup) — the general per-group number **Aggregations** remain. **Saved filters** — superseded by per-view `config.filters` (ADR-039).
- Recurring tasks spawn the next occurrence on completion (board drag-to-complete doesn't yet — follow-up).

---

## Project Overview & Files pages (ADR-046)

Two new per-project routes, both **independent loads** (gated by `canAccessProject` → 404, NOT the heavy `canEditProject`/403 settings load) so non-editors get a read-only view. Registered in the sidebar `projectNav` (Overview first; Files after Locations).

- **Overview** (`/projects/[id]/overview`): a calm, document-like editor for project **title + description** — borderless inputs with no focus ring (title strictly larger than description), auto-save on blur. Reuses the settings **`updateProject`** action (`export { actions } from '../settings/+page.server'`); that action now also `broadcastProjectChange`es + runs mention notifications, and is **patch-style for `startDate`/`dueDate`** (`form.has` guards) so saving title/description from Overview — which posts neither date — doesn't null them. Description is a `MentionEditor`; read-only viewers see a heading + `RichText`.
- **Files** (`/projects/[id]/files`): aggregates **every** file in a project — task attachments, custom-field uploads, and project-level files — with search, type/source filters, grid⇄list, image lightbox, download, and delete. Uploads go through a new **`GET`/`POST /api/projects/{id}/files`** endpoint (project-level files = `taskId`+`fieldId` both null; mirrors `POST /api/files` validation: 10 MB, blocked-ext, server-derived MIME, `storagePath` never returned). The load attributes each file to its source (task / custom field / project) via `inArray` lookups.
- **Fix**: `DELETE /api/files/[id]` now strips the deleted id from BOTH `task_custom_value` and `project_custom_value` arrays (previously only the former — a latent orphan for project-entity `files` fields).

---

## "@" inline-token references (ADR-047)

Typing `@` in a description or comment opens a **caret-anchored** picker (search input + Task/Location/File/Project/Person pills + filtered results + "Create new" rows) that inserts an inline token. References render as clickable chips; mentioning a **person** fires a `notification` (`type: 'mention'`).

- **Storage = inline tokens, no schema change**: `@[label](kind:id)` lives in the existing plain-text columns (`task.description`, `comment.body`, `project.description`). `label` is denormalized (fallback when the entity is deleted); for `person`, `id` is the user id. Helpers in **`src/lib/mentions.ts`** (`parseMentions`/`buildToken`/`extractRefs`/`detectQuery`) — client + server safe, tolerant (never throws on half-typed tokens).
- **Rendering = `RichText.svelte`**, a tokenizer that emits text spans + chips. **No `{@html}`** (the codebase bans it) — chips are real Svelte elements, labels interpolated (no stored-XSS). Dangling ids degrade to a muted, non-interactive label. Chip targets: task → `onSelectTask` (opens the pane; non-interactive where no handler is given), file → `/api/files/[id]`, project → `/projects/[id]`, person/location → styled tooltip chip (no bespoke per-type navigation — that was tried and reverted).
- **Bare URLs auto-link (Notion/Linear behaviour)**: `RichText` runs each plain-text segment through **`linkify()`** (`src/lib/mentions.ts`) which detects `http(s)://`, `www.`, and email and renders them as real `<a>` (target=_blank, `rel="noopener noreferrer"`; `www.`→`https://`, email→`mailto:`). Render-only — the stored text is never rewritten. Hrefs are restricted to http(s)/mailto (regex never matches `javascript:` etc.), and trailing sentence punctuation is pushed back out of the link. Editing stays a plain `<textarea>` (no contenteditable rich editor); links appear in the rendered view, not while typing.
- **Editing = `MentionEditor.svelte`** — a **contenteditable** editor (NOT a `<textarea>`) so mentions render as **inline pills `[kind | label]` while typing** (the Notion/Linear WYSIWYG behaviour; a textarea can only show the raw `@[…](…)` token). The stored value is still the plain-text token format: the DOM is **serialized** to it on every input (text nodes + `data-token` pills + `<br>`→`\n`) and **re-rendered** from it on external value changes only (a `lastValue` guard avoids clobbering the caret on our own edits). Caret anchoring uses the **native Selection API** (`getRangeAt().getBoundingClientRect()`) — no mirror-div needed (the old `MentionTextarea`/`caret.ts` were deleted). Pills are `contenteditable=false` (atomic backspace) and clickable (task→`onSelectTask`, project/file→new tab). Enter inserts a `\n` text node (not a browser `<div>`); paste is forced to plain text. Form submission: a hidden `<input name=…>` mirrors the value; the host's blur handler does `closest('form')?.requestSubmit()` (contenteditable has no `.form`). Detection keeps focus in the editor (blur auto-save undisturbed; suppressed while the menu is open); Arrow/Enter/Escape drive the menu, **Cmd/Ctrl+Enter passes through** to the host. "Create" rows: Task (always), Location + File-upload (project-edit only); Project/Person are select-only. Create-and-link calls the existing REST endpoints (`POST /api/tasks`, `…/locations`, `…/files`) then `invalidateAll()`. (Also fixed a pre-existing SSR crash: `SidePane`'s `onDestroy` used `document` unguarded — `onDestroy` runs during SSR, so a full-page load of a `?task=` deep-link 500'd; now guarded.)
- **Reuses `page.data` not prop-drilling**: `TaskPanel`/`TaskComments` read mention candidates (`tasks`/`users`/`locations`/`files`/`allProjects`/`perm.project`) from `page.data` + `page.params` directly (they only ever render on the board route), so no threading through the 6 view components. The reusable leaf components take resolver data as explicit props instead.
- **Server**: `src/lib/server/mentions.ts` `notifyMentions(...)` (async, fire-and-forget) diffs new vs prior `person:` refs to notify only the **newly** mentioned, skipping the actor, and **only users who can access the project** (intersected with `projectAccessUserIds` — `person:<id>` is attacker-controlled text, so a hand-crafted token can't notify or leak context to arbitrary users). Hooked into `patchTask`, comment POST/PATCH (REST + the form actions), and `updateProject`.

## Custom-field mention chips (ADR-051)

**Context.** ADR-047 covered task/location/file/project/person references. Users want a task's description to inline one of its OWN custom fields — e.g. typing `@Estimated Cost` and having it render as `[Estimated Cost | $500]`, kept live as the value changes.

**Decision.** Add a sixth mention kind **`field`** (token `@[<field name>](field:<fieldId>)`). It is **display-only, resolved at RENDER time**: the chip shows `[field name | current value]` where the value = the owning task's stored custom value formatted by a new **pure helper `fieldDisplayText(field, raw, resolvers)`** in `src/lib/customFields.ts`. That helper was **extracted from the project-page header-chip code** (`projectFieldDisplay`), which now delegates to it — one source of truth for field→string. Reference-type values (select/person/place/task) resolve ids via the same rosters already threaded into `RichText`/`MentionEditor` (+ `fieldOptions`); the two components gained `fields`/`fieldOptions`/`fieldValues` props. The `@` picker offers only the task's OWN applicable fields (`visibleCustomFields`), **select-only** (no create row); the "Field" filter pill hides when no fields are in scope. **Scope v1 = the task description** (edit via a two-tone MentionEditor pill, read via a RichText chip). No schema change (token lives in the existing text column); `notifyMentions` ignores non-person kinds, so field refs never notify/leak.

**Consequences.** A field chip always reflects the current value (nothing denormalized beyond the fallback label). `rollup`/number-rollup fields resolve to `''` (computed, not stored) — offered but empty. `fieldDisplayText` is unit-tested (8 cases) and shared with the header chips. **Deferred:** field mentions in comments and project-entity fields on the Overview description — both just need their field data threaded into the editor.

---

## Auth hardening (ADR-048)

**Context.** A whole-codebase security review found no exploitable issues, but auth policy was implicit: password floor at 8, no explicit session lifetime (BetterAuth's ~30-day default), and rate limiting left to BetterAuth's defaults with nothing documenting the posture.

**Decision.** Make the policy explicit in `src/lib/server/auth.ts`: `minPasswordLength: 12`; `session: { expiresIn: 14d, updateAge: 1d }`; and an explicit `rateLimit` block (`enabled` only under `NODE_ENV=production`, `window: 60s`, `max: 100`) that documents BetterAuth's default rather than changing it. Seed passwords move to `SEED_ADMIN_PASSWORD`/`SEED_DEMO_PASSWORD` env vars (`scripts/seed.ts`) with dev-only fallbacks; `.env.example` documents all of the above. `scripts/seed.ts`'s auth config mirrors the 12-char minimum (kept in sync per the schema-sync rule).

**Consequences.** New registrations require 12+ char passwords (existing hashes unaffected). Sessions expire sooner. REST `bsk_` keys are 256-bit random, so bearer brute-force is not a practical vector and is intentionally left un-throttled. **Non-goal:** the `permission` table still has no level column, so `canAccessProject ≡ canEditProject` for non-admins (no view-only tier); adding read-only sharing would require a `level` column + split guards and is deferred as a product decision.

- **File-upload permission tiers (clarified, same review).** Task data follows access-level rules (ADR-019), project structure follows edit-level: `POST /api/tasks/[id]/files` (task attachment) and `POST /api/files` (custom-field value) gate on `canAccessProject`; `POST /api/projects/[id]/files` (project-level file = structure) gates on `canAccessProject`→404 then `canEditProject`→403. Non-exploitable today (access≡edit) — aligned for clarity + future-proofing.
- **Missing-project sub-resource 404 (same review).** Four project sub-resource GETs (`custom-fields`, `custom-values`, `files`, `templates`) returned `200` (empty) for a NON-EXISTENT project when the caller was an admin, because `canAccessProject` short-circuits `true` for admins without an existence check. They now load the project row and `404` first, matching the eight sibling sub-resources. Locked by `tests/integration/api-authz.test.ts`.

---

## Service layer: action ↔ REST unification (ADR-049)

**Context.** UI→API parity (ADR-036) was built by PORTING each form action's logic into a parallel REST endpoint, leaving TWO copies of every domain's write logic. A whole-codebase review confirmed the copies had already drifted (create wrote different fields; only one patch copy did completed-cascade/recurrence/mention/assignee-notify; `statusId=''` meant "default" vs "invalid"; per-scope milestone actions were even triply-duplicated across the project page, settings page, and REST). Divergence in a guard is how a future vuln or bug creeps in.

**Decision.** Extract one SERVICE MODULE per domain — `src/lib/server/{tasks,statuses,labels,milestones,views}.ts` — holding all validation, permission guards, DB writes, and side effects (broadcast, notifyMentions, logActivity, recurrence spawn, completed cascade, custom-field writes). Each service function returns a discriminated `ServiceResult<T>` (`{ok:true,data}` | `{ok:false,status,message}`). Form actions and REST endpoints become thin adapters that differ ONLY in input parsing (FormData vs JSON) and response shaping (`fail()`/`redirect()` vs `json()`/status). Per-caller behavioral differences that had to be preserved are expressed as service inputs/option flags (e.g. `has(key)` for partial patch, `logActivity`, `completeCascade`, `notifyMentions`, `emptyOk`, `maxNameLen`, `owner` scope), NOT as duplicated code. Shared helpers extracted: `src/lib/server/graph.ts` (`createsCycle` DFS) and `src/lib/server/api.ts` (`parseDateField`). (Custom-fields + comments already had service modules — `src/lib/server/{customFields,comments}.ts`.)

**Consequences.** Domain logic lives once; the two entry points can no longer drift. `+page.server.ts` dropped 1897→1266 lines; ~2600 duplicated lines removed across callers. Behavior is preserved (all 391 unit + 83 integration tests green throughout); a handful of REST error-MESSAGE strings were unified to the form-action wording (same HTTP status codes; no test asserts message text). **Rule:** a new mutation gets a service function + thin adapters — never a fresh copy of the logic. **Deferred (not done):** giant client-file extractions (viewConfig mutators out of `+page.svelte`, the rollup-resolver closure shared by TaskPanel/TableView, native `draggable`→`use:sortable` on the view-tab bar) — low line-savings, tightly coupled to Svelte reactivity/drag, and not covered by automated tests, so deferred rather than risked.

## Multi-dialect database: SQLite + Postgres (ADR-050)

**Context.** The app was SQLite-only (`drizzle-orm/better-sqlite3`, one `sqlite-core` schema). Users asked to run it on Postgres (and MySQL). Drizzle schemas are dialect-specific (`sqliteTable`/`pgTable`/`mysqlTable`) with divergent column types and a dialect-specific runtime driver, so this is not a drop-in driver swap. Assessment: 287/314 db calls are already `await`-style (async drivers slot in with no call-site changes) and there is zero raw SQL — but the query surface uses `.returning()` (×23) and `onConflictDoUpdate` (×19). SQLite and Postgres both support those; **MySQL supports neither** (`.returning()` doesn't exist; upsert is `onDuplicateKeyUpdate`) and additionally can't key/PK `TEXT` columns (needs `varchar(n)`), so MySQL would require rewriting ~42 service-layer sites + a varchar-keyed schema.

**Decision.** Ship **SQLite (default) + Postgres**, selectable via `DB_DIALECT` in `.env` (`sqlite` | `postgres`); `DATABASE_URL` is the connection (file path vs `postgres://…`). MySQL is deferred (structure is MySQL-ready). **Per-dialect schema files, runtime-selected:**
- `schema.sqlite.ts` (canonical, unchanged) + `schema.pg.ts` (byte-identical table/column *names*; only types differ — `integer(mode:'boolean'|'timestamp')`→native `boolean`/`timestamp`, `real`→`doublePrecision`; `text` PKs are fine in PG).
- `schema.ts` is now a **facade**: it picks the active module by `DIALECT` and casts the PG schema onto the sqlite types (`pgSchema as unknown as typeof sqliteSchema`), then re-exports all 32 tables — so the ~65 importers and `db` typing stay on ONE canonical shape. A conditional `pgTable`/`sqliteTable` union would collapse Drizzle's query-builder type inference; the cast keeps types sound (SQL is produced by the driver-matched `db` instance, not the table object's declared type).
- `src/lib/server/db/dialect.ts` is the single dialect source of truth, read from **`process.env.DB_DIALECT`** (not `$env/dynamic/private`) so it also imports cleanly from standalone scripts (`seed.ts`, `drizzle.config.ts`). `index.ts` selects driver+schema and casts the PG `db` to the sqlite `db` type; `auth.ts`/`seed.ts` map the BetterAuth adapter `provider` (`sqlite`→`sqlite`, `postgres`→`pg`); `drizzle.config.ts` branches `schema`/`out`/`dialect`/`dbCredentials` off the env. `drizzle/` (generate output) is gitignored — the project stays push-based.

**Consequences.** Existing SQLite deploys are unchanged (default; `db:push` reports "No changes" against `schema.sqlite.ts`). Postgres works end-to-end: `DB_DIALECT=postgres npx drizzle-kit generate` emits valid PG DDL for all 32 tables, and the facade correctly yields native `boolean`/`timestamp` columns under that env. New dep: `postgres` (postgres-js). **Rule:** any schema change must be applied to BOTH `schema.sqlite.ts` and `schema.pg.ts` in lockstep (same table/column names). **Deferred:** MySQL (needs an `insertReturning()` + `upsert()` shim across the ~42 `.returning()`/`onConflict` sites, plus a varchar-keyed `schema.mysql.ts`).
