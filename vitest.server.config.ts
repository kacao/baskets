import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Isolated-DB characterization tests for the service layer (permissions/tasks).
// These mutate a database, so they run against a DEDICATED sqlite file
// (./data/test-server.db) that is NEVER the dev DB (./data/baskets.db). The
// isolation is established by setting DB_DIALECT/DATABASE_URL in the *shell env*
// of the `test:server` npm script (see package.json) — that guarantees the vars
// are in `process.env` before Vite loads this config, which is required because
// `$env/dynamic/private` (consumed by src/lib/server/db/index.ts) bakes its
// values at Vite config-load time. `globalSetup` provisions the schema + a
// sentinel row via a direct better-sqlite3 connection; `setupFiles` runs the
// isolationGuard tripwire in-worker before any test can mutate via the `db`
// singleton. Deliberately separate from vitest.config.ts (default `npm test`/
// `npm run test:unit`) so it never affects that suite.
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'node',
		globals: true,
		include: ['tests/server/**/*.{test,spec}.ts'],
		globalSetup: ['./tests/server/globalSetup.ts'],
		setupFiles: ['./tests/server/isolationGuard.ts'],
		testTimeout: 20000,
		hookTimeout: 20000
	}
});
