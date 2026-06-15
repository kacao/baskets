# Baskets

Self-hosted project management — workspaces → projects → tasks → sub-tasks. Linear/Notion-inspired, built with Tailwind 4 + DaisyUI 5 (light/dark themes).

## Stack

SvelteKit (Svelte 5 runes) · Tailwind 4 + DaisyUI 5 · SQLite via better-sqlite3 + Drizzle ORM · BetterAuth (email/password, TOTP 2FA, admin plugin) · adapter-node.

## Setup

```bash
npm install
cp .env.example .env        # set a real BETTER_AUTH_SECRET (openssl rand -hex 32)
npm run db:push             # create tables in ./data/baskets.db
npm run db:seed             # optional: admin + demo users + sample data
npm run dev                 # http://localhost:5173
```

Seeded accounts (change after first login):

| Account | Email | Password |
| --- | --- | --- |
| Admin | admin@baskets.local | admin-baskets-2026 |
| Demo | demo@baskets.local | demo-baskets-2026 |

Without seeding, register at `/register` — promote the first user to admin manually: `sqlite3 data/baskets.db "update user set role='admin' where email='you@example.com'"`.

## Features

- Email/password auth + optional TOTP 2FA with backup codes; per-user API keys (`bsk_…`) for the REST API
- **Workspaces** own projects, custom statuses, and labels; owner + grants gate structure edits and define visibility (you see only what you own or were granted). Sidebar workspace switcher.
- **Projects** with an optional emoji icon, project status, and pin; a "…" menu for edit/pin/status/icon/labels/delete
- **Views** per project — table, board (drag-and-drop, split panel), list, dashboard, map (Leaflet/OSM). Multiple per type; add/hide/duplicate/delete via the viewbar "+" and per-tab right-click menu. The **table** view is a real table with a show/hide-columns menu, sub-task chevrons, and an inline new-task dialog.
- **Tasks**: colored statuses (category-driven behavior; pill + popover picker), priority, assignee, milestone, workspace labels, due date, dependencies (cycle-checked), one level of sub-tasks (done-category parent completes subs). Editing opens a shared right-side pane (used for task, milestones, and view-customize editing alike)
- **Realtime** (WebSockets, `/ws`): live updates — when anyone changes a project, open viewers auto-refresh — plus presence avatars showing who else is viewing
- Statuses: five fixed app-wide defaults + workspace- and project-scoped custom statuses, each with a color
- REST API under `/api/{projects,tasks}` (session cookie or `Authorization: Bearer bsk_…`); see `/llms.txt`. Slack integration (incoming webhook) for project/task events
- Light/dark DaisyUI themes (topbar toggle, cookie-persisted); responsive mobile sidebar; ≤200ms transitions, reduced-motion safe
- Admin → Users: create, toggle admin, ban/unban, remove

See `PRD.md` for product scope and `ADR.md` for architecture decisions.

## Production

```bash
npm run build
ORIGIN=https://your-domain npm run start   # custom server.js: adapter-node handler + /ws WebSocket
```

`npm start` runs `server.js` (a thin `http.createServer` wrapping the generated `build/handler.js` and attaching the realtime `/ws` transport), not `build/index.js` — adapter-node's default entry has no WebSocket upgrade hook. Keep `src/lib/server/realtime/attach.js` deployed alongside `build/`. Single Node process only; clustering would need a shared pub/sub fan-out.

## Notes

- `src/lib/server/db/schema.ts` holds both BetterAuth tables and app tables; after changing it run `npm run db:push`.
- DB file location is `DATABASE_URL` in `.env` (default `./data/baskets.db`); the `data/` dir is kept in git via `.gitkeep`, the DB files themselves are gitignored. WAL mode enabled when the filesystem supports it.
- `static/llms.txt` documents the REST API for agents — keep it updated when the API changes.
- Theming (Tailwind 4 + DaisyUI 5, token bridge, light/dark cookie) is documented in `ADR.md` (ADR-022).
