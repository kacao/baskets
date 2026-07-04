import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import postgres from 'postgres';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
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
type DB = BetterSQLite3Database<typeof sqliteSchema>;

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
