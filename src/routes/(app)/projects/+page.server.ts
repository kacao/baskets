import { fail, redirect } from '@sveltejs/kit';
import { desc, eq, and, isNull, count, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, status, task } from '$lib/server/db/schema';
import { dispatchEvent } from '$lib/server/integrations';
import { canEditProject } from '$lib/server/permissions';
import { createProjectWithDefaults } from '$lib/server/projects';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const projects = await db
		.select({
			id: project.id,
			name: project.name,
			description: project.description,
			createdAt: project.createdAt,
			taskCount: count(task.id),
			doneCount: sql<number>`coalesce(sum(case when ${status.category} = 'done' then 1 else 0 end), 0)`
		})
		.from(project)
		.leftJoin(task, and(eq(task.projectId, project.id), isNull(task.parentId)))
		.leftJoin(status, eq(task.statusId, status.id))
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

		const id = await createProjectWithDefaults({
			name,
			description: description || null,
			creator: locals.user
		});

		void dispatchEvent({ type: 'project.created', actor: locals.user.name, projectName: name });

		redirect(303, `/projects/${id}`);
	},

	delete: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Missing project id' });
		if (!(await canEditProject(locals.user, id)))
			return fail(403, { message: 'No edit permission on this project' });

		await db.delete(project).where(eq(project.id, id));
		return { success: true };
	}
};
