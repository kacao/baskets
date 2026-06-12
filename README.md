# Baskets

Simple single-tenant project management — projects → tasks → sub-tasks. Linear/Notion-inspired, styled with the [StudioBlank](https://designmd.ai/chef/studioblank-design-system) ultra-minimal design system (see `design.md`).

## Stack

SvelteKit (Svelte 5) · SQLite via better-sqlite3 + Drizzle ORM · BetterAuth (email/password, TOTP 2FA, admin plugin) · adapter-node.

## Setup

```bash
npm install
cp .env.example .env        # set a real BETTER_AUTH_SECRET (openssl rand -hex 32)
npm run db:push             # create tables in ./baskets.db
npm run db:seed             # optional: admin + demo users + sample data
npm run dev                 # http://localhost:5173
```

Seeded accounts (change after first login):

| Account | Email | Password |
| --- | --- | --- |
| Admin | admin@baskets.local | admin-baskets-2026 |
| Demo | demo@baskets.local | demo-baskets-2026 |

Without seeding, register at `/register` — the first user must then be promoted to admin manually: `sqlite3 baskets.db "update user set role='admin' where email='you@example.com'"`.

## Features

- Email/password auth + optional TOTP 2FA with backup codes; per-user API keys (`bsk_…`) for the REST API
- Projects with multiple views — table, board (Linear-style drag-and-drop, split task panel), list (ranked by an `order` field, expandable sub-tasks), dashboard, map (Leaflet/OSM via a task `lat, lng` location). Only Table is enabled by default; "+" enables the rest (one view per type)
- Tasks: table-driven statuses with behavior categories (app-wide pool + project-scoped statuses), priority, assignee, milestone, labels (optional groups), due date, dependencies (cycle-checked; sub-tasks only on siblings), one level of sub-tasks (done-category parent completes subs)
- Per-project settings pane (`/projects/:id/settings`): general, statuses, labels, dependencies, milestones, edit grants, delete
- Permissions: reads and task editing open to all members; structure edits (project/views/statuses/milestones) need admin or a project/view grant
- REST API under `/api/{projects,tasks}` (session cookie or `Authorization: Bearer bsk_…`); Slack integration (incoming webhook) for project/task events
- i18n (English, Vietnamese) — switch in Settings; whole UI translated, user content untouched
- Admin → Users: create users, toggle admin role, ban/unban, remove
- Responsive (mobile sidebar), ≤200ms transitions, reduced-motion safe

See `PRD.md` for product scope and `ADR.md` for architecture decisions.

## Theming

All visual tokens live in `src/app.css` under `[data-theme='studioblank']`. To add a theme, define a new `[data-theme='...']` block and switch the `data-theme` attribute in `src/app.html`. Components only consume tokens.

## Production

```bash
npm run build
ORIGIN=https://your-domain npm run start   # serves build/ via node
```

## Notes

- `src/lib/server/db/schema.ts` holds both BetterAuth tables and app tables; after changing it run `npm run db:push`.
- DB file location is `DATABASE_URL` in `.env` (default `./baskets.db`). WAL mode is enabled when the filesystem supports it.
