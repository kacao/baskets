import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Integration tests hit the running dev server (http://localhost:5173) over fetch,
// so they live outside the default unit `include` and run on demand via
// `npm run test:integration` (node environment, longer timeout). They are NOT part
// of `npm test` because they require a live server + seeded DB.
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'node',
		globals: true,
		include: ['tests/integration/**/*.{test,spec}.ts'],
		testTimeout: 20000,
		hookTimeout: 20000
	}
});
