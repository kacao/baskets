import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';

// Two seed-default statuses (ensureDefaultStatuses / createProjectWithDefaults):
// every new project is eligible for the five built-ins. We tag tasks with two
// distinct ones so a Status facet filter is observable.
const STATUS_A = 'Backlog';
const STATUS_B = 'In progress';

// Unique-per-run marker so assertions don't collide with seed data.
const RUN = `vf-${Date.now()}`;
const TASK_A = `${RUN}-alpha`; // Backlog
const TASK_B = `${RUN}-beta`; //  In progress

async function signIn(page: Page) {
	await page.goto('/login');
	await page.locator('#email').fill(ADMIN_EMAIL);
	await page.locator('#password').fill(ADMIN_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/projects/);
}

/**
 * Create a throwaway project + two tasks (distinct statuses) over the REST API,
 * reusing the page's authenticated cookie jar. Returns the project id.
 * POST /api/projects → createProjectWithDefaults (one Table view, built-in
 * statuses). POST /api/tasks accepts a status NAME and defaults position.
 */
async function seedProject(page: Page): Promise<string> {
	const pRes = await page.request.post('/api/projects', {
		data: { name: `${RUN} project` }
	});
	expect(pRes.ok()).toBeTruthy();
	const projectId = (await pRes.json()).project.id as string;

	for (const [title, status] of [
		[TASK_A, STATUS_A],
		[TASK_B, STATUS_B]
	] as const) {
		const tRes = await page.request.post('/api/tasks', {
			data: { projectId, title, status }
		});
		expect(tRes.ok()).toBeTruthy();
	}
	return projectId;
}

async function cleanup(page: Page, projectId: string | undefined) {
	if (!projectId) return;
	// Project DELETE cascades its tasks/views (see /api/projects/[id]).
	await page.request.delete(`/api/projects/${projectId}`).catch(() => {});
}

/**
 * Open the "+" add-view menu, create a view of the given type, then click the
 * resulting tab to activate it (createView inserts but does not auto-switch).
 */
async function addView(page: Page, type: 'Board' | 'List') {
	const menu = page.locator('.add-view-menu');
	await expect(async () => {
		await page.getByRole('button', { name: 'Add a view' }).click();
		await expect(menu).toBeVisible({ timeout: 1000 });
	}).toPass();
	await menu.getByRole('button', { name: type, exact: true }).click();
	// New tab is named after the type; click it so the view becomes active.
	const tab = page.locator('.viewbar').getByRole('link', { name: type, exact: true });
	await expect(tab).toBeVisible();
	await tab.click();
	await expect(tab).toHaveClass(/active/);
}

/** Open the Status facet popover and toggle the option with the given label. */
async function toggleStatusFacet(page: Page, label: string) {
	await page.getByRole('button', { name: 'Status', exact: true }).first().click();
	await page.getByRole('button', { name: label, exact: true }).click();
	// Close the popover so it doesn't overlay the view; click the bar background.
	await page.keyboard.press('Escape');
}

// Serial: each case signs in fresh; running them in parallel can trip
// BetterAuth's sign-in rate limiting and bounce back to /login.
test.describe.configure({ mode: 'serial' });

test.describe('views + filter', () => {
	let projectId: string | undefined;

	test.afterEach(async ({ page }) => {
		await cleanup(page, projectId);
		projectId = undefined;
	});

	test('switch view tabs (Table/Board/List) on a project', async ({ page }) => {
		await signIn(page);
		projectId = await seedProject(page);
		await page.goto(`/projects/${projectId}`);

		// New projects ship with one Table view; both seeded tasks are visible.
		await expect(page.getByText(TASK_A, { exact: true })).toBeVisible();
		await expect(page.getByText(TASK_B, { exact: true })).toBeVisible();

		// Add a Board view, then a List view, via the "+" add-view affordance.
		for (const type of ['Board', 'List'] as const) {
			await addView(page, type);
			// The new tab becomes active and both tasks render in the new view.
			await expect(page.getByText(TASK_A, { exact: true }).first()).toBeVisible();
			await expect(page.getByText(TASK_B, { exact: true }).first()).toBeVisible();
		}

		// Tabs for all three view types now exist in the viewbar.
		const viewbar = page.locator('.viewbar');
		await expect(viewbar.getByRole('link', { name: /Table/ })).toBeVisible();
		await expect(viewbar.getByRole('link', { name: /Board/ })).toBeVisible();
		await expect(viewbar.getByRole('link', { name: /List/ })).toBeVisible();
	});

	test('FilterBar status filter narrows the Table row set', async ({ page }) => {
		await signIn(page);
		projectId = await seedProject(page);
		await page.goto(`/projects/${projectId}`);

		const rows = page.locator('tr.task-row');
		// Baseline: at least our two tasks are present (tolerant of any extras).
		await expect(page.getByText(TASK_A, { exact: true })).toBeVisible();
		await expect(page.getByText(TASK_B, { exact: true })).toBeVisible();
		const before = await rows.count();
		expect(before).toBeGreaterThanOrEqual(2);

		// Filter to STATUS_A only → the beta (In progress) task drops out.
		await toggleStatusFacet(page, STATUS_A);

		await expect(page.getByText(TASK_A, { exact: true })).toBeVisible();
		await expect(page.getByText(TASK_B, { exact: true })).toHaveCount(0);

		const after = await rows.count();
		expect(after).toBeLessThan(before);
		expect(after).toBeGreaterThanOrEqual(1);

		// Clear restores both tasks.
		await page.getByRole('button', { name: /Clear/ }).click();
		await expect(page.getByText(TASK_A, { exact: true })).toBeVisible();
		await expect(page.getByText(TASK_B, { exact: true })).toBeVisible();
	});

	test('FilterBar status filter narrows the Board card set', async ({ page }) => {
		await signIn(page);
		projectId = await seedProject(page);
		await page.goto(`/projects/${projectId}`);

		// Switch to a Board view.
		await addView(page, 'Board');

		const cards = page.locator('.bcard');
		await expect(page.locator('.bcard', { hasText: TASK_A })).toBeVisible();
		await expect(page.locator('.bcard', { hasText: TASK_B })).toBeVisible();
		const before = await cards.count();
		expect(before).toBeGreaterThanOrEqual(2);

		// Filter to STATUS_B only → the alpha (Backlog) card drops out.
		await toggleStatusFacet(page, STATUS_B);

		await expect(page.locator('.bcard', { hasText: TASK_B })).toBeVisible();
		await expect(page.locator('.bcard', { hasText: TASK_A })).toHaveCount(0);

		const after = await cards.count();
		expect(after).toBeLessThan(before);
		expect(after).toBeGreaterThanOrEqual(1);
	});
});
