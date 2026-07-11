import { test, expect, type Page } from '@playwright/test';

// Regression suite for the task side-pane behaviour fixes + UX changes:
//  - the pane must NOT close when an input inside it blurs (readPaneParam / shallow
//    routing fix) — reproducible ONLY when the pane was opened by an in-app click;
//  - a confirm dialog's Escape must cancel the dialog WITHOUT closing the pane;
//  - date pills open a calendar (no native mm/dd/yyyy field) and saving keeps the pane;
//  - the Sub-tasks section is collapsed by default and auto-expands on the first add;
//  - the Description section is collapsible and its state persists per task;
//  - number custom fields have working −/+ steppers.

const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';
const RUN = `pb-${Date.now().toString(36)}`;

async function signIn(page: Page) {
	await page.goto('/login');
	await page.locator('#email').fill(ADMIN_EMAIL);
	await page.locator('#password').fill(ADMIN_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/projects/);
}

async function seedProject(page: Page): Promise<string> {
	const res = await page.request.post('/api/projects', { data: { name: `${RUN} project` } });
	expect(res.ok()).toBeTruthy();
	return (await res.json()).project.id as string;
}

async function seedTask(page: Page, projectId: string, title: string): Promise<string> {
	const res = await page.request.post('/api/tasks', { data: { projectId, title } });
	expect(res.ok()).toBeTruthy();
	return (await res.json()).task.id as string;
}

async function seedNumberField(page: Page, projectId: string, name: string): Promise<string> {
	const res = await page.request.post(`/api/projects/${projectId}/custom-fields`, {
		data: { name, type: 'number', config: { numberFormat: 'number' }, appliesTo: 'all' }
	});
	expect(res.ok()).toBeTruthy();
	return (await res.json()).customField.id as string;
}

// Open the task pane the way a USER does — by clicking the row title — so the pane
// state is written via SHALLOW routing (page.url goes stale). A deep-link goto
// would NOT reproduce the "input blur closes the pane" bug.
async function openTaskPane(page: Page, projectUrl: string, title: string) {
	await page.goto(projectUrl);
	const titleBtn = page.locator('button.task-title', { hasText: title });
	await expect(titleBtn).toBeVisible();
	const pane = page.getByRole('complementary', { name: 'Task details' });
	// Retry the click: a click landing before hydration wires the handler is lost.
	await expect(async () => {
		await titleBtn.click();
		await expect(pane).toBeVisible({ timeout: 1000 });
	}).toPass();
	return pane;
}

test.describe.configure({ mode: 'serial' });

test.describe('task pane behaviour', () => {
	let projectId: string | undefined;
	let projectUrl = '';

	test.beforeEach(async ({ page }) => {
		await signIn(page);
		projectId = await seedProject(page);
		projectUrl = `/projects/${projectId}`;
	});

	test.afterEach(async ({ page }) => {
		if (projectId) await page.request.delete(`/api/projects/${projectId}`).catch(() => {});
		projectId = undefined;
	});

	test('stays open when a description input blurs, and when a delete confirm is cancelled', async ({
		page
	}) => {
		await seedTask(page, projectId!, `${RUN} blur task`);
		const pane = await openTaskPane(page, projectUrl, `${RUN} blur task`);

		// Focus the description editor, then click OUTSIDE the pane (the search box).
		// Before the readPaneParam fix, the blur's auto-save invalidateAll re-ran the
		// view's URL effect with a stale page.url and closed the pane.
		await pane.locator('.desc-editor').click();
		await page.getByRole('searchbox', { name: 'Search tasks' }).click();
		await expect(pane).toBeVisible();

		// Now open the delete confirm and CANCEL with Escape — the dialog must close
		// but the pane must remain (Escape must not bubble to the pane's own handler).
		await pane.getByRole('button', { name: 'Delete task' }).click();
		const dialog = page.locator('.cm-card[role="dialog"]');
		await expect(dialog).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(pane).toBeVisible();
		// task still exists in the table (delete was cancelled)
		await expect(page.locator('button.task-title', { hasText: `${RUN} blur task` })).toBeVisible();
	});

	test('due-date pill opens a calendar and picking a day saves without closing the pane', async ({
		page
	}) => {
		await seedTask(page, projectId!, `${RUN} date task`);
		const pane = await openTaskPane(page, projectUrl, `${RUN} date task`);

		await pane.getByRole('button', { name: 'Due date' }).click();
		// The custom DatePicker renders a calendar grid immediately (no native input).
		const calendar = page.locator('.cal');
		await expect(calendar).toBeVisible();
		await expect(page.locator('input[type="date"]')).toHaveCount(0);

		// Pick "Today" (deterministic), which saves and closes the popover.
		await calendar.getByRole('button', { name: 'Today' }).click();
		await expect(calendar).toBeHidden();
		await expect(pane).toBeVisible();
		// the pill now shows a saved date (ISO yyyy-mm-dd), not the placeholder.
		await expect(pane.getByRole('button', { name: 'Due date' })).toContainText(/\d{4}-\d{2}-\d{2}/);
	});

	test('sub-tasks section is collapsed by default and auto-expands after the first sub-task', async ({
		page
	}) => {
		await seedTask(page, projectId!, `${RUN} parent task`);
		const pane = await openTaskPane(page, projectUrl, `${RUN} parent task`);

		const subToggle = pane.locator('.sub-toggle', { hasText: 'Sub-tasks' });
		await expect(subToggle).toHaveAttribute('aria-expanded', 'false');
		// the icon-only add button sits in the header even while collapsed
		const addBtn = pane.locator('.sub-header').getByRole('button', { name: 'Add sub-task' });
		await expect(addBtn).toBeVisible();

		// add the first sub-task → the section should auto-expand. The popover panel
		// is portaled to <body>, so its input/button live OUTSIDE the pane subtree.
		await addBtn.click();
		await page.getByPlaceholder('Search or create…').fill(`${RUN} sub`);
		await page.getByRole('button', { name: `Create task “${RUN} sub”` }).click();

		await expect(subToggle).toHaveAttribute('aria-expanded', 'true');
		await expect(pane.getByRole('button', { name: `${RUN} sub` })).toBeVisible();
	});

	test('description section collapses and the collapsed state persists across reload', async ({
		page
	}) => {
		await seedTask(page, projectId!, `${RUN} desc task`);
		const pane = await openTaskPane(page, projectUrl, `${RUN} desc task`);

		const descToggle = pane.locator('.sub-toggle', { hasText: 'Description' });
		await expect(descToggle).toHaveAttribute('aria-expanded', 'true');
		await expect(pane.locator('.desc-editor')).toBeVisible();

		// collapse it
		await descToggle.click();
		await expect(descToggle).toHaveAttribute('aria-expanded', 'false');
		await expect(pane.locator('.desc-editor')).toHaveCount(0);

		// reload → the collapsed state persists (localStorage, scoped to this task)
		await page.reload();
		const pane2 = page.getByRole('complementary', { name: 'Task details' });
		await expect(pane2).toBeVisible();
		await expect(pane2.locator('.sub-toggle', { hasText: 'Description' })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
	});

	test('number custom field −/+ steppers adjust the value and save on blur', async ({ page }) => {
		await seedTask(page, projectId!, `${RUN} num task`);
		await seedNumberField(page, projectId!, 'Qty');
		const pane = await openTaskPane(page, projectUrl, `${RUN} num task`);

		// open the Qty pill → the number editor with steppers
		await pane.locator('.cf-pill', { hasText: 'Qty' }).getByRole('button').first().click();
		const increase = page.getByRole('button', { name: 'Increase' });
		await expect(increase).toBeVisible();

		// three increments accumulate locally (no per-click save race)
		await increase.click();
		await increase.click();
		await increase.click();
		await expect(page.locator('.num-input')).toHaveValue('3');

		// blur saves once → the pill reflects the value
		await page.locator('.num-input').blur();
		await expect(pane.locator('.cf-pill', { hasText: 'Qty' })).toContainText('3');
	});
});
