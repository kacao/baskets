import { fail, redirect } from '@sveltejs/kit';
import { asc, count, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, user, workspace } from '$lib/server/db/schema';
import {
	accessibleWorkspaceIds,
	canEditWorkspace,
	grantedProjectIds
} from '$lib/server/permissions';
import { isFirstWorkspaceForUser, seedWorkspaceSamples } from '$lib/server/projects';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const workspaces = await db
		.select({
			id: workspace.id,
			name: workspace.name,
			ownerId: workspace.ownerId,
			ownerName: user.name,
			projectCount: count(project.id)
		})
		.from(workspace)
		.leftJoin(user, eq(workspace.ownerId, user.id))
		.leftJoin(project, eq(project.workspaceId, workspace.id))
		.groupBy(workspace.id)
		.orderBy(asc(workspace.name));

	// ADR-019: list only accessible workspaces (incl. ones holding a granted project)
	const [wsAccess, projGrants] = await Promise.all([
		accessibleWorkspaceIds(locals.user),
		grantedProjectIds(locals.user)
	]);
	let visible = workspaces;
	if (wsAccess !== 'all') {
		const grantedWsIds = new Set(
			projGrants.size > 0
				? (
						await db
							.select({ workspaceId: project.workspaceId })
							.from(project)
							.where(inArray(project.id, [...projGrants]))
					).map((r) => r.workspaceId)
				: []
		);
		visible = workspaces.filter((w) => wsAccess.has(w.id) || grantedWsIds.has(w.id));
	}

	return {
		workspaces: await Promise.all(
			visible.map(async (w) => ({
				...w,
				editable: await canEditWorkspace(locals.user, w.id)
			}))
		)
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();

		if (!name) return fail(400, { message: 'Workspace name is required' });
		if (name.length > 120) return fail(400, { message: 'Name too long (max 120)' });

		const existing = await db.select({ name: workspace.name }).from(workspace);
		if (existing.some((w) => w.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A workspace with that name already exists' });

		// the user's first workspace gets sample projects/milestones/tasks
		const seedSamples = await isFirstWorkspaceForUser(locals.user.id);

		const id = crypto.randomUUID();
		const now = new Date();
		await db.insert(workspace).values({
			id,
			name,
			ownerId: locals.user.id,
			createdAt: now,
			updatedAt: now
		});

		if (seedSamples) await seedWorkspaceSamples(id, locals.user);

		redirect(303, `/workspaces/${id}/settings`);
	}
};
