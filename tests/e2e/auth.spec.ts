import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';

// Each test starts from a clean (unauthenticated) context — the default
// per-test isolation in Playwright gives a fresh cookie jar, so there is no
// shared session to clean up between cases.

test.describe('auth', () => {
	test('unauthenticated visit to a protected route redirects to /login', async ({ page }) => {
		// /projects lives in the (app) group; its layout server load redirects
		// to /login when there is no session (ADR-019: visibility = access).
		await page.goto('/projects');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
	});

	test('sign in with the seeded admin, land on the app shell, then sign out', async ({ page }) => {
		await page.goto('/login');

		await page.locator('#email').fill(ADMIN_EMAIL);
		await page.locator('#password').fill(ADMIN_PASSWORD);
		await page.getByRole('button', { name: 'Sign in' }).click();

		// Successful sign-in routes to /projects (the app shell).
		await expect(page).toHaveURL(/\/projects/);

		// The app shell topbar shows the signed-in user's name + a Sign out button.
		const signOut = page.getByRole('button', { name: 'Sign out' });
		await expect(signOut).toBeVisible();

		// Sign out returns to /login and the protected route is gated again.
		await signOut.click();
		await expect(page).toHaveURL(/\/login$/);

		await page.goto('/projects');
		await expect(page).toHaveURL(/\/login$/);
	});
});
