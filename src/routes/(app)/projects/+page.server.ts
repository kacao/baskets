import { fail, redirect } from '@sveltejs/kit';
import { asc, desc, eq, and, isNull, count, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, status, task, workspace } from '$lib/server/db/schema';
import { dispatchEvent } from '$lib/server/integrations';
import {
	accessibleWorkspaceIds,
	canEditProject,
	canEditWorkspace,
	grantedProjectIds
} from '$lib/server/permissions';
import { createProjectWithDefaults } from '$lib/server/projects';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [projects, workspaces] = await Promise.all([
		db
			.select({
				id: project.id,
				name: project.name,
				description: project.description,
				icon: project.icon,
				workspaceId: project.workspaceId,
				pinned: project.pinned,
				createdAt: project.createdAt,
				taskCount: count(task.id),
				doneCount: sql<number>`coalesce(sum(case when ${status.category} = 'completed' then 1 else 0 end), 0)`
			})
			.from(project)
			.leftJoin(task, and(eq(task.projectId, project.id), isNull(task.parentId)))
			.leftJoin(status, eq(task.statusId, status.id))
			.groupBy(project.id)
			.orderBy(desc(project.pinned), desc(project.createdAt)),
		db
			.select({ id: workspace.id, name: workspace.name })
			.from(workspace)
			.orderBy(asc(workspace.name))
	]);

	// ADR-019: only accessible workspaces/projects are shown
	const [wsAccess, projGrants] = await Promise.all([
		accessibleWorkspaceIds(locals.user),
		grantedProjectIds(locals.user)
	]);
	const visible =
		wsAccess === 'all'
			? projects
			: projects.filter(
					(p) => (p.workspaceId && wsAccess.has(p.workspaceId)) || projGrants.has(p.id)
				);
	const visibleWorkspaces =
		wsAccess === 'all' ? workspaces : workspaces.filter((w) => wsAccess.has(w.id));

	return {
		projects: visible,
		workspaces: await Promise.all(
			visibleWorkspaces.map(async (w) => ({
				...w,
				creatable: await canEditWorkspace(locals.user, w.id)
			}))
		)
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		const workspaceId = String(form.get('workspaceId') ?? '');

		if (!name) return fail(400, { message: 'Project name is required' });
		if (name.length > 120) return fail(400, { message: 'Name too long (max 120)' });

		const [ws] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
		if (!ws) return fail(400, { message: 'Pick a workspace for the project' });
		if (!(await canEditWorkspace(locals.user, ws.id)))
			return fail(403, { message: 'No permission to create projects in this workspace' });

		const id = await createProjectWithDefaults({
			name,
			description: description || null,
			workspaceId: ws.id,
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
