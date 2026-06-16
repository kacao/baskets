import { defineConfig, devices } from '@playwright/test';

// A dev server is ALREADY running on :5173 — do NOT start/kill one here.
export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	// Tests share ONE live dev server + SQLite DB, so they must run serially —
	// parallel workers create/delete projects concurrently and interfere.
	fullyParallel: false,
	workers: 1,
	retries: 1,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:5173',
		trace: 'on-first-retry'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
