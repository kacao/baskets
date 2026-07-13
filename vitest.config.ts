import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Use the SvelteKit plugin so `$lib` and `$app` aliases resolve in tests.
// Pure-logic tests run fine under jsdom too; component tests need it for the DOM.
export default defineConfig({
	plugins: [sveltekit()],
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./tests/setup.ts'],
		include: ['src/**/*.{test,spec}.ts', 'tests/unit/**/*.{test,spec}.ts'],
		exclude: ['tests/e2e/**', 'node_modules/**', 'build/**', '.svelte-kit/**'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.{ts,svelte}'],
			exclude: ['src/**/*.{test,spec}.ts', '.svelte-kit/**', 'build/**']
		}
	}
});
