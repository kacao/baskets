# CLAUDE.md

Baskets — single-tenant project management app (projects → tasks → sub-tasks). Linear/Notion-inspired, styled with the RawBlock brutalist design system (`design.md` is the source of truth for visual rules).

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
- Tasks: one level of nesting only — `task.parentId` set ⇒ sub-task; sub-tasks cannot have children (enforced in createTask action). Marking a parent done marks its subs done.

## Conventions

- **Theming**: all visual tokens are CSS variables in `src/app.css` under `[data-theme='rawblock']`. Components must only consume tokens — never hardcode colors/radii. New theme = new `[data-theme]` block.
- RawBlock rules: no rounded corners, no shadows (borders organize), black-on-white, Archivo Black headings, full color-inversion hover states, uppercase + letterspaced buttons/labels.
- Tabs for indentation; single quotes.
- Single tenant: all signed-in users see all projects. Authorization is only signed-in vs admin.
- `.env` is gitignored; secrets read via `$env/dynamic/private` (server) or `process.env` (scripts).
