import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import postgres from 'postgres';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import * as sqliteSchema from './schema.sqlite';
import * as pgSchema from './schema.pg';
import { DIALECT } from './dialect';

// Multi-dialect Drizzle client (ADR-050). DB_DIALECT selects the driver + schema;
// DATABASE_URL is the connection (a file path for sqlite, a postgres:// URL for pg).
// `db` is typed against the sqlite schema (canonical) so every call site compiles
// uniformly; the Postgres instance is structurally compatible for the query
// surface this app uses (select/insert/update/delete/.returning/onConflictDoUpdate/
// transaction) and is cast to the same type.
export type DB = BetterSQLite3Database<typeof sqliteSchema>;

function createDb(): DB {
	if (DIALECT === 'postgres') {
		if (!env.DATABASE_URL) {
			throw new Error(
				'DATABASE_URL (postgres:// connection string) is required when DB_DIALECT=postgres'
			);
		}
		const client = postgres(env.DATABASE_URL, { max: 10 });
		return drizzlePg(client, { schema: pgSchema }) as unknown as DB;
	}

	const sqlite = new Database(env.DATABASE_URL ?? './data/baskets.db');
	try {
		sqlite.pragma('journal_mode = WAL');
	} catch {
		// some filesystems (network mounts) don't support WAL — fall back to default
	}
	sqlite.pragma('foreign_keys = ON');
	return drizzleSqlite(sqlite, { schema: sqliteSchema });
}

export const db = createDb();

/**
 * Run `fn` atomically against the active dialect (ADR-057).
 *
 * The two drivers have incompatible transaction signatures: better-sqlite3's
 * `db.transaction(fn)` callback is SYNCHRONOUS and returns `T` directly (not a
 * Promise) — an async callback would commit before its awaited work runs, so it
 * can't host this app's async service layer. postgres-js/pg-core's `transaction`
 * is properly async (`fn: (tx) => Promise<T>`). Because a single call can't serve
 * both drivers, sqlite instead issues a manual `BEGIN IMMEDIATE` / `COMMIT` /
 * `ROLLBACK` on the shared connection (single-tenant, low-concurrency — ADR-050 —
 * so a single in-flight transaction at a time is an acceptable trade-off; this is
 * NOT safe for concurrent overlapping transactions on one connection).
 *
 * Side effects (dispatchEvent, broadcastProjectChange, notifyMentions,
 * logActivity, createNotification, …) must NOT be called from inside `fn` — do
 * them in the caller after this resolves, using the returned value. `fn` should
 * contain only DB writes.
 */
export async function withTransaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
	if (DIALECT === 'postgres') {
		return (
			db as unknown as { transaction: (f: (tx: DB) => Promise<T>) => Promise<T> }
		).transaction((tx) => fn(tx));
	}
	await db.run(sql`BEGIN IMMEDIATE`);
	try {
		const result = await fn(db);
		await db.run(sql`COMMIT`);
		return result;
	} catch (e) {
		try {
			await db.run(sql`ROLLBACK`);
		} catch {
			// already rolled back / connection closed — ignore
		}
		throw e;
	}
}
