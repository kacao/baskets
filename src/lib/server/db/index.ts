import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

const sqlite = new Database(env.DATABASE_URL ?? './baskets.db');
try {
	sqlite.pragma('journal_mode = WAL');
} catch {
	// some filesystems (network mounts) don't support WAL — fall back to default
}
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
