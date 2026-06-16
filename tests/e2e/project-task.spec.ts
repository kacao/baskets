import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';

// A unique suffix per run keeps this test self-isolating + idempotent: nothing
// it creates collides with seed data or a previous (failed) run.
const RUN = Date.now().toString(36);
const PROJECT_NAME = `E2E project ${RUN}`;
const TASK_TITLE = `E2E task ${RUN}`;
const TASK_TITLE_EDITED = `E2E task ${RUN} edited`;
const TASK_DESC = `Described by the e2e suite (${RUN}).`;
const SUBTASK_TITLE = `E2E sub-task ${RUN}`;

async function signIn(page: Page) {
	await page.goto('/login');
	await page.locator('#email').fill(ADMIN_EMAIL);
	await page.locator('#password').fill(ADMIN_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/projects/);
}

// Create a project via the /projects "+ New project" form action; returns the
// project page URL it redirects to (/projects/<id>).
async function createProject(page: Page): Promise<string> {
	await page.goto('/projects');
	await page.getByRole('button', { name: '+ New project' }).click();

	await page.locator('#name').fill(PROJECT_NAME);
	// The Workspace <select> is required; the first creatable workspace is
	// pre-selected, so leaving it as-is is enough for the seeded admin.
	await page.getByRole('button', { name: 'Create project' }).click();

	// create() redirects (303) to the new project page.
	await expect(page).toHaveURL(/\/projects\/[^/]+$/);
	await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();
	return page.url();
}

// Delete the project through the header "…" menu → Delete. That action uses a
// native confirm() dialog (not the in-app modal), so accept it.
async function deleteProject(page: Page, projectUrl: string) {
	await page.goto(projectUrl);
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Project menu' }).click();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	// deleteProject redirects back to the project list.
	await expect(page).toHaveURL(/\/projects\/?$/);
}

test.describe('project + task lifecycle', () => {
	test('create a project, add a task, edit it, add a sub-task, then delete it', async ({
		page
	}) => {
		await signIn(page);

		let projectUrl = '';
		try {
			// --- Create + open a project ---
			projectUrl = await createProject(page);

			// --- Create a task via the project "…" → Create… → Task pane ---
			await page.getByRole('button', { name: 'Project menu' }).click();
			await page.getByRole('button', { name: 'Create…' }).hover();
			await page.getByRole('button', { name: 'Task', exact: true }).click();

			// New-task pane (NewTaskPane): fill Title + Create.
			await page.locator('#nt-title').fill(TASK_TITLE);
			await page.getByRole('button', { name: 'Create', exact: true }).click();

			// The task lands in the default Table view as a clickable title button.
			const taskTitleBtn = page.locator('button.task-title', { hasText: TASK_TITLE });
			await expect(taskTitleBtn).toBeVisible();

			// --- Open the task side pane via the title click ---
			// SidePane is an <aside aria-label="Task details"> → ARIA `complementary`.
			await taskTitleBtn.click();
			const pane = page.getByRole('complementary', { name: 'Task details' });
			await expect(pane).toBeVisible();

			// --- Edit title (auto-saves on blur) ---
			const titleInput = pane.getByLabel('Title');
			await titleInput.fill(TASK_TITLE_EDITED);
			await titleInput.blur();

			// --- Edit description (auto-saves on blur) ---
			const descInput = pane.getByLabel('Description');
			await descInput.fill(TASK_DESC);
			await descInput.blur();

			// The edited title should propagate back to the table row.
			await expect(
				page.locator('button.task-title', { hasText: TASK_TITLE_EDITED })
			).toBeVisible();

			// --- Add a sub-task via the "Add sub-task" popover ---
			await pane.getByRole('button', { name: 'Add sub-task' }).click();
			const subSearch = pane.getByPlaceholder('Search or create…');
			await subSearch.fill(SUBTASK_TITLE);
			// No matching childless task → "Create task" submit appears.
			await pane.getByRole('button', { name: `Create task “${SUBTASK_TITLE}”` }).click();

			// The new sub-task renders in the pane's sub-task list.
			await expect(pane.getByRole('button', { name: SUBTASK_TITLE })).toBeVisible();

			// --- Delete the task via the footer "Delete task" + confirm modal ---
			await pane.getByRole('button', { name: 'Delete task' }).click();
			// ConfirmModal renders an aria-modal dialog with the message text + a
			// danger "Delete" confirm button (no accessible name on the dialog).
			const confirmModal = page.locator('[role="dialog"][aria-modal="true"]');
			await expect(confirmModal).toBeVisible();
			await expect(confirmModal).toContainText(/Delete this task/i);
			await confirmModal.getByRole('button', { name: 'Delete', exact: true }).click();

			// Pane closes and the task is gone from the table.
			await expect(
				page.locator('button.task-title', { hasText: TASK_TITLE_EDITED })
			).toHaveCount(0);
		} finally {
			// --- Clean up: delete the project regardless of assertion outcome ---
			if (projectUrl) await deleteProject(page, projectUrl);
		}
	});
});
