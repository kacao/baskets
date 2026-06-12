# CLAUDE.md

Baskets — single-tenant project management app (projects → tasks → sub-tasks). Linear/Notion-inspired, styled with the StudioBlank ultra-minimal design system (`design.md` is the source of truth for visual rules). Product scope: `PRD.md`. Architecture decisions: `ADR.md`.

## Commands

```bash
npm run dev          # dev server on :5173
npm run build        # production build (adapter-node → build/)
npm run check        # svelte-kit sync + svelte-check (run before committing)
npm run db:push      # apply src/lib/server/db/schema.ts to SQLite (drizzle-kit push)
npm run db:seed      # seed admin/demo users + sample data (idempotent; skips if admin exists)
npm run start        # serve production build (reads .env)
```

No test suite yet. Verify changes with `npm run check` + manual smoke test.

## Stack

- SvelteKit 2 + **Svelte 5 runes** (`$props`, `$state`, `$derived` — no legacy `export let` / `$:`)
- SQLite via better-sqlite3 + Drizzle ORM (`DATABASE_URL` in `.env`, default `./baskets.db`)
- BetterAuth 1.6 with `twoFactor` (TOTP) and `admin` plugins

## Architecture

- `src/lib/server/db/schema.ts` — ALL tables: BetterAuth tables (user, session, account, verification, twoFactor) AND app tables (project, task). BetterAuth field requirements change between versions; if it errors about a missing field, add the column here and `npm run db:push`. Keep `scripts/seed.ts`'s auth config in sync with `src/lib/server/auth.ts`.
- `src/lib/server/auth.ts` — BetterAuth instance. `src/lib/auth-client.ts` — browser client (used for auth + admin actions). `src/hooks.server.ts` — populates `locals.user` / `locals.session` on every request.
- Routes: `(auth)` group = login/register/two-factor (redirects away if signed in); `(app)` group = everything else (redirects to /login if not; its `+layout.svelte` is the shell with sidebar). `/admin` additionally requires `locals.user.role === 'admin'` (enforced in its `+page.server.ts`).
- Data mutations: SvelteKit form actions in `+page.server.ts` files (projects, tasks). Exception: auth/2FA/admin-user actions go through `authClient` (BetterAuth API) client-side.
- REST API: `src/routes/api/{projects,tasks}` `+server.ts` endpoints (GET/POST/PATCH/DELETE). Auth via session cookie OR `Authorization: Bearer bsk_…` API key. Keys are managed per-user in /settings (SHA-256 hash stored in `api_key` table, plaintext shown once); `src/lib/server/api-keys.ts` generates/resolves them, `src/hooks.server.ts` resolves the bearer header into `locals.user`. Shared validation helpers in `src/lib/server/api.ts`.
- Integrations: `integration` table (one row per `type`, single tenant), managed at /integrations. `src/lib/server/integrations/index.ts` exports `dispatchEvent(event)` — call it fire-and-forget (`void dispatchEvent(...)`, never await) after mutations; it never throws. Events: `project.created`, `task.created`, `task.completed`. Slack uses an incoming webhook (URL must start with `https://hooks.slack.com/`; never sent back to the client). New integration = new module in `src/lib/server/integrations/` + a case in `dispatchEvent`.
- Tasks: one level of nesting only — `task.parentId` set ⇒ sub-task; sub-tasks cannot have children (enforced in createTask action). Setting a parent to a `done`-category status cascades to its subs.
- Statuses: table-driven (`status` + `project_status` eligibility). Behavior keys off `status.category` (`todo|active|done|canceled`), never the name. Built-ins bootstrapped in `src/lib/server/statuses.ts` (`ensureDefaultStatuses`, called from hooks) — keep `scripts/seed.ts` in sync. Admin CRUD of app-wide statuses at /settings/statuses; labels (+groups) at /settings/labels. Statuses can also be project-scoped (`status.projectId` set): managed in /projects/[id]/settings, auto-eligible, name uniqueness enforced in code per scope (no DB unique). Project structure management lives in the /projects/[id]/settings pane (general/statuses/labels/deps/milestones/grants/delete).
- Views: `view` table, one Svelte component per type in `src/lib/components/views/` (table/board/list/dashboard/map). Enable-style: ONE view per type per project, only Table on by default (created by `createProjectWithDefaults` in `src/lib/server/projects.ts` — always create projects through that helper); the "+" in the view bar enables others; type is fixed after enablement. Project must keep ≥1 view. View config is schemaless JSON; treat keys as optional hints. Map uses Leaflet (client-only import), `task.location` = "lat, lng".
- Permissions: reads AND task editing open to all signed-in users (`canEditTask` ⇒ signed-in). Structure edits (project meta/delete, views, eligible statuses, milestones, project labels) need admin or a `permission` grant row — check via `src/lib/server/permissions.ts` (`canEditProject/View`) in EVERY structure mutation (form action + REST). Project grant covers its views; grants managed by admins in the project Edit panel.
- Milestones (`milestone`, per project, `task.milestoneId` same-project), labels (`label`/`label_group` + join tables), dependencies (`project_dependency`, `task_dependency` — same project, sub-tasks only on siblings, DFS cycle check). Dependencies are informational only.

## Conventions

- **i18n**: every user-facing UI string goes through `$t('English text')` from `$lib/i18n` — English strings are the keys (en = passthrough). Add the Vietnamese translation to `src/lib/i18n/vi.ts` in the same change. Never translate DB content (status/label/project/task/user names). Locale = `locale` cookie, switcher in /settings.

- **ADR.md**: every architecture/design decision (new dependency, schema approach, auth model, API shape, theming strategy, etc.) gets a new `ADR-NNN` record — context, decision, consequences. Update an existing record's status (`Superseded by ADR-NNN`) instead of rewriting history.

- **Theming**: all visual tokens are CSS variables in `src/app.css` under `[data-theme='studioblank']` (active; legacy `rawblock` block kept for reference). Components must only consume tokens — never hardcode colors/radii. New theme = new `[data-theme]` block, switched via `data-theme` in `src/app.html`.
- StudioBlank rules: whitespace-first, monochrome (#0A0A0A on #FAFAFA), Inter with weight contrast (body Light 300, headings Bold/SemiBold), 1px hairline borders (#D4D4D8 subtle / #0A0A0A strong), no radius, no shadows, no uppercase labels, animations ≤200ms.
- Tabs for indentation; single quotes.
- Single tenant: all signed-in users see all projects. Authorization is only signed-in vs admin.
- `.env` is gitignored; secrets read via `$env/dynamic/private` (server) or `process.env` (scripts).
