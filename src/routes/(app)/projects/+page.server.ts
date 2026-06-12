import { fail, redirect } from '@sveltejs/kit';
import { desc, eq, and, isNull, count, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, task } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const projects = await db
		.select({
			id: project.id,
			name: project.name,
			description: project.description,
			createdAt: project.createdAt,
			taskCount: count(task.id),
			doneCount: sql<number>`coalesce(sum(case when ${task.status} = 'done' then 1 else 0 end), 0)`
		})
		.from(project)
		.leftJoin(task, and(eq(task.projectId, project.id), isNull(task.parentId)))
		.groupBy(project.id)
		.orderBy(desc(project.createdAt));

	return { projects };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();

		if (!name) return fail(400, { message: 'Project name is required' });
		if (name.length > 120) return fail(400, { message: 'Name too long (max 120)' });

		const id = crypto.randomUUID();
		const now = new Date();

		await db.insert(project).values({
			id,
			name,
			description: description || null,
			createdBy: locals.user.id,
			createdAt: now,
			updatedAt: now
		});

		redirect(303, `/projects/${id}`);
	},

	delete: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Missing project id' });

		await db.delete(project).where(eq(project.id, id));
		return { success: true };
	}
};
