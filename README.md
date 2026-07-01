# Baskets

Self-hosted project management — workspaces → projects → tasks → sub-tasks.

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

Without seeding, register at `/register`, then promote the first user to admin:

```bash
sqlite3 data/baskets.db "update user set role='admin' where email='you@example.com'"
```

## Production

```bash
npm run build
ORIGIN=https://your-domain npm run start
```

## Features

- Email/password auth, optional TOTP 2FA, per-user API keys for the REST API
- Workspaces own projects, custom statuses, and labels; owner + grants control sharing and visibility
- Projects with multiple views — table, board, list, dashboard, map, timeline, calendar, and flow
- Per-project **Overview** (title/description editor) and **Files** pages, plus milestones, locations, labels, and custom fields
- Tasks with statuses, priority, assignee, milestones, labels, start/due dates, locations, dependencies, and one level of sub-tasks
- Typed custom fields (text, number, select, date, person, files, task, rollup, …) on tasks and projects
- **@-mention references** — link Tasks, Locations, Files, Projects, or People inside descriptions/comments (inline pills); bare URLs auto-link; mentions notify
- Realtime live updates and presence avatars
- Search and filter across views
- Comments, activity log, and in-app notifications
- Bulk actions, task templates, recurring tasks, and CSV export
- Photo/document capture, mobile-responsive
- REST API and Slack integration

See `PRD.md` for product scope and `ADR.md` for architecture decisions.
