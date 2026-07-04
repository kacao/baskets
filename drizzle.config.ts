import { defineConfig } from 'drizzle-kit';
import { resolveDialect } from './src/lib/server/db/dialect';

// drizzle-kit introspects ONE dialect at a time — pick it (and the matching schema
// file + creds) from DB_DIALECT so `npm run db:push` targets the active database
// (ADR-050). sqlite → schema.sqlite.ts + file path; postgres → schema.pg.ts + URL.
const dialect = resolveDialect(process.env.DB_DIALECT);

export default defineConfig(
	dialect === 'postgres'
		? {
				schema: './src/lib/server/db/schema.pg.ts',
				out: './drizzle/pg',
				dialect: 'postgresql',
				dbCredentials: { url: process.env.DATABASE_URL as string }
			}
		: {
				schema: './src/lib/server/db/schema.sqlite.ts',
				out: './drizzle',
				dialect: 'sqlite',
				dbCredentials: { url: process.env.DATABASE_URL ?? './data/baskets.db' }
			}
);
