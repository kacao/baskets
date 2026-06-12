import { error, fail, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, task, user } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const STATUSES = ['todo', 'in_progress', 'done'] as const;
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

export const load: PageServerLoad = async ({ params }) => {
	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) error(404, 'Project not found');

	const tasks = await db
		.select()
		.from(task)
		.where(eq(task.projectId, params.id))
		.orderBy(asc(task.position), asc(task.createdAt));

	const users = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.orderBy(asc(user.name));

	return { project: proj, tasks, users };
};

export const actions: Actions = {
	createTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const parentId = String(form.get('parentId') ?? '') || null;
		const priority = String(form.get('priority') ?? 'none');

		if (!title) return fail(400, { message: 'Task title is required' });
		if (title.length > 240) return fail(400, { message: 'Title too long (max 240)' });
		if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number]))
			return fail(400, { message: 'Invalid priority' });

		if (parentId) {
			const [parent] = await db.select().from(task).where(eq(task.id, parentId));
			if (!parent || parent.projectId !== params.id)
				return fail(400, { message: 'Invalid parent task' });
			if (parent.parentId)
				return fail(400, { message: 'Sub-tasks cannot have their own sub-tasks' });
		}

		const now = new Date();
		await db.insert(task).values({
			id: crypto.randomUUID(),
			projectId: params.id,
			parentId,
			title,
			priority,
			createdBy: locals.user.id,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});

		return { success: true };
	},

	setStatus: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const status = String(form.get('status') ?? '');

		if (!id || !STATUSES.includes(status as (typeof STATUSES)[number]))
			return fail(400, { message: 'Invalid status update' });

		await db.update(task).set({ status, updatedAt: new Date() }).where(eq(task.id, id));

		// Completing a parent completes its sub-tasks
		if (status === 'done') {
			await db
				.update(task)
				.set({ status: 'done', updatedAt: new Date() })
				.where(eq(task.parentId, id));
		}

		return { success: true };
	},

	updateTask: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		const priority = String(form.get('priority') ?? 'none');
		const assigneeId = String(form.get('assigneeId') ?? '') || null;
		const dueDateRaw = String(form.get('dueDate') ?? '');

		if (!id) return fail(400, { message: 'Missing task id' });
		if (!title) return fail(400, { message: 'Task title is required' });
		if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number]))
			return fail(400, { message: 'Invalid priority' });

		const dueDate = dueDateRaw ? new Date(dueDateRaw + 'T00:00:00') : null;

		await db
			.update(task)
			.set({
				title,
				description: description || null,
				priority,
				assigneeId,
				dueDate,
				updatedAt: new Date()
			})
			.where(eq(task.id, id));

		return { success: true };
	},

	deleteTask: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Missing task id' });

		await db.delete(task).where(eq(task.parentId, id)); // sub-tasks first
		await db.delete(task).where(eq(task.id, id));
		return { success: true };
	},

	updateProject: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();

		if (!name) return fail(400, { message: 'Project name is required' });

		await db
			.update(project)
			.set({ name, description: description || null, updatedAt: new Date() })
			.where(eq(project.id, params.id));

		return { success: true };
	},

	deleteProject: async ({ params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		await db.delete(project).where(eq(project.id, params.id));
		redirect(303, '/projects');
	}
};
