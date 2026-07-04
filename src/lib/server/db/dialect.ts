// Single source of truth for the active SQL dialect (ADR-050). Read from the
// plain `process.env` (NOT `$env/dynamic/private`) so this module is importable
// from BOTH the SvelteKit server runtime AND standalone scripts (seed.ts,
// drizzle.config.ts) — the SvelteKit-only virtual module can't resolve there.
// DATABASE_URL still drives the connection; DB_DIALECT selects the driver+schema.
//
// Supported now: 'sqlite' (default) | 'postgres'. 'mysql' is reserved for a
// follow-up (needs insert-returning + upsert shims — see ADR-050).
export type Dialect = 'sqlite' | 'postgres';

export function resolveDialect(raw: string | undefined | null): Dialect {
	const v = (raw ?? '').trim().toLowerCase();
	if (v === 'postgres' || v === 'postgresql' || v === 'pg') return 'postgres';
	return 'sqlite';
}

export const DIALECT: Dialect = resolveDialect(process.env.DB_DIALECT);
