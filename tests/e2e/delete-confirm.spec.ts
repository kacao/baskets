import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';

// Regression for the cancel-on-delete fix (ADR confirm-modal pattern): the
// SavedFilters delete trigger is a type="button" that awaits confirmDialog()
// and only calls form?.requestSubmit() on confirm — so cancelling the modal
// (Escape or the Cancel button) must leave the saved filter intact. A
// regression to onsubmit+preventDefault on the use:enhance form would fire the
// fetch regardless and delete the row even on cancel.

const RUN = `dc-${Date.now()}`;
const FILTER_NAME = `${RUN}-keep-me`;

async function signIn(page: Page) {
	await page.goto('/login');
	await page.locator('#email').fill(ADMIN_EMAIL);
	await page.locator('#password').fill(ADMIN_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/projects/);
}

// Create a throwaway project over the REST API, reusing the page's
// authenticated cookie jar. createProjectWithDefaults gives it one Table view.
async function seedProject(page: Page): Promise<string> {
	const res = await page.request.post('/api/projects', {
		data: { name: `${RUN} project` }
	});
	expect(res.ok()).toBeTruthy();
	return (await res.json()).project.id as string;
}

async function cleanup(page: Page, projectId: string | undefined) {
	if (!projectId) return;
	await page.request.delete(`/api/projects/${projectId}`).catch(() => {});
}

// Open the "Saved filters" popover (button carries the label text + aria-label).
// Idempotent: only clicks the trigger when the panel isn't already showing, so a
// retry can't toggle an open panel shut.
async function openSavedFilters(page: Page) {
	const nameInput = page.getByPlaceholder('Name this filter…');
	const sf = page.getByRole('button', { name: 'Saved filters' });
	await expect(async () => {
		if (!(await nameInput.isVisible())) await sf.click();
		await expect(nameInput).toBeVisible({ timeout: 1000 });
	}).toPass();
}

// Click the trash button for the saved filter row, tolerating the post-save
// invalidateAll re-render that briefly detaches the row.
async function clickDelete(page: Page) {
	const delBtn = page
		.locator('.sf-item', { hasText: FILTER_NAME })
		.getByRole('button', { name: 'Delete' });
	await expect(async () => {
		await openSavedFilters(page);
		await delBtn.click({ timeout: 1000 });
	}).toPass();
}

test.describe.configure({ mode: 'serial' });

test.describe('delete confirm — cancel leaves the row intact', () => {
	let projectId: string | undefined;

	test.afterEach(async ({ page }) => {
		await cleanup(page, projectId);
		projectId = undefined;
	});

	test('cancelling the saved-filter delete confirm does NOT delete it', async ({ page }) => {
		await signIn(page);
		projectId = await seedProject(page);
		await page.goto(`/projects/${projectId}`);

		// Create + save a named filter via the SavedFilters popover.
		await openSavedFilters(page);
		await page.getByPlaceholder('Name this filter…').fill(FILTER_NAME);
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		// The saved filter now appears in the list (apply button carries its name).
		const savedItem = page.getByRole('button', { name: FILTER_NAME, exact: true });
		await expect(async () => {
			await openSavedFilters(page);
			await expect(savedItem).toBeVisible({ timeout: 1000 });
		}).toPass();

		// Trigger its delete → the confirm modal appears. (The Popover panel also
		// uses role=dialog, so scope to the centered ConfirmModal card.)
		await clickDelete(page);
		const dialog = page.locator('.cm-card[role="dialog"]');
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('Delete this saved filter?');

		// CANCEL: press Escape (ConfirmModal maps Escape → cancel).
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();

		// The filter must STILL EXIST — reopen the popover and assert it's listed.
		await expect(async () => {
			await openSavedFilters(page);
			await expect(page.getByRole('button', { name: FILTER_NAME, exact: true })).toBeVisible({
				timeout: 1000
			});
		}).toPass();

		// Also cancel via the Cancel button this time, same expectation.
		await clickDelete(page);
		const dialog2 = page.locator('.cm-card[role="dialog"]');
		await expect(dialog2).toBeVisible();
		await dialog2.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog2).toBeHidden();

		await expect(async () => {
			await openSavedFilters(page);
			await expect(page.getByRole('button', { name: FILTER_NAME, exact: true })).toBeVisible({
				timeout: 1000
			});
		}).toPass();
	});
});
