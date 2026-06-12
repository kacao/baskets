# Baskets

Simple single-tenant project management — projects → tasks → sub-tasks. Linear/Notion-inspired, styled with the [RawBlock](https://designmd.ai/chef/rawblock) brutalist design system (see `design.md`).

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

- Email/password auth + optional TOTP 2FA (Google Authenticator etc.) with backup codes — enable in Settings
- Projects with progress bars; tasks with status (todo / in progress / done), priority, assignee, due date; one level of sub-tasks (completing a parent completes its subs)
- Admin → Users: create users, toggle admin role, ban/unban, remove
- Responsive (mobile sidebar), animated transitions, reduced-motion safe

## Theming

All visual tokens live in `src/app.css` under `[data-theme='rawblock']`. To add a theme, define a new `[data-theme='...']` block and switch the `data-theme` attribute in `src/app.html` (or set it dynamically). Components only consume tokens.

## Production

```bash
npm run build
ORIGIN=https://your-domain npm run start   # serves build/ via node
```

## Notes

- `src/lib/server/db/schema.ts` holds both BetterAuth tables and app tables; after changing it run `npm run db:push`.
- DB file location is `DATABASE_URL` in `.env` (default `./baskets.db`). WAL mode is enabled when the filesystem supports it.
