import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Runs ONCE, in a separate context from the test workers, before any test file
// is collected. Responsible for provisioning a completely fresh, isolated sqlite
// file at ./data/test-server.db and planting a sentinel row that the in-worker
// isolationGuard (tests/server/isolationGuard.ts) uses to PROVE the `db`
// singleton (built from `$env/dynamic/private` inside src/lib/server/db/index.ts)
// actually opened this file and not the dev DB (./data/baskets.db).
//
// Uses a DIRECT better-sqlite3 connection (never `$lib/server/db`) so this file
// has zero dependency on the app's env-resolution timing.

const DB_PATH = path.resolve(process.cwd(), 'data/test-server.db');

const SENTINEL_USER_ID = '__ISO_SENTINEL_USER__';
const SENTINEL_WORKSPACE_ID = '__ISO_SENTINEL__';
const SENTINEL_ORG_ID = '__ISO_SENTINEL_ORG__';

export default async function setup() {
	// 1. Nuke any previous test DB (+ WAL/SHM sidecars) for a clean slate.
	for (const suffix of ['', '-wal', '-shm']) {
		const p = DB_PATH + suffix;
		if (existsSync(p)) rmSync(p);
	}

	// 2. Apply the sqlite schema via drizzle-kit push, forcing dialect+creds via
	// its own env (does not depend on / mutate this process's env).
	execSync('npx drizzle-kit push --force', {
		cwd: process.cwd(),
		env: {
			...process.env,
			DB_DIALECT: 'sqlite',
			DATABASE_URL: './data/test-server.db'
		},
		stdio: 'pipe'
	});

	if (!existsSync(DB_PATH)) {
		throw new Error(`globalSetup: expected ${DB_PATH} to exist after drizzle-kit push`);
	}

	// 3. Plant the sentinel user + workspace via a direct connection.
	const sqlite = new Database(DB_PATH);
	try {
		sqlite.pragma('foreign_keys = ON');
		const now = Date.now();

		sqlite
			.prepare(
				`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(SENTINEL_USER_ID, 'Isolation Sentinel', 'iso-sentinel@example.invalid', 0, now, now);

		// The fresh test schema gives workspace.organization_id a real FK, so the
		// sentinel org must exist before the sentinel workspace references it.
		sqlite
			.prepare(`INSERT INTO organization (id, name, slug, created_at) VALUES (?, ?, ?, ?)`)
			.run(SENTINEL_ORG_ID, '__ISO_SENTINEL__', '__iso_sentinel__', now);

		sqlite
			.prepare(
				`INSERT INTO workspace (id, name, owner_id, organization_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(SENTINEL_WORKSPACE_ID, '__ISO_SENTINEL__', SENTINEL_USER_ID, SENTINEL_ORG_ID, now, now);
	} finally {
		sqlite.close();
	}
}
