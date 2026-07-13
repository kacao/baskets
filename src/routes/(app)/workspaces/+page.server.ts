import { fail, redirect } from '@sveltejs/kit';
import { asc, count, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, user, workspace } from '$lib/server/db/schema';
import {
	accessibleWorkspaceIds,
	canEditWorkspace,
	grantedProjectIds
} from '$lib/server/permissions';
import { createWorkspaceService, resolveActiveOrg } from '$lib/server/orgs';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const org = await resolveActiveOrg(locals.user, cookies);
	if (!org) return { workspaces: [] };

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
		.where(eq(workspace.organizationId, org.id))
		.groupBy(workspace.id)
		.orderBy(asc(workspace.name));

	// ADR-019: list only accessible workspaces (incl. ones holding a granted project)
	const [wsAccess, projGrants] = await Promise.all([
		accessibleWorkspaceIds(locals.user, org.id),
		grantedProjectIds(locals.user, org.id)
	]);
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
	const visible = workspaces.filter((w) => wsAccess.has(w.id) || grantedWsIds.has(w.id));

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
	create: async ({ request, locals, cookies }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const org = await resolveActiveOrg(locals.user, cookies);
		if (!org) return fail(400, { message: 'No active organization' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '');

		const res = await createWorkspaceService({
			name,
			ownerId: locals.user.id,
			organizationId: org.id
		});
		if (!res.ok) return fail(res.status, { message: res.message });

		redirect(303, `/workspaces/${res.data.id}/settings`);
	}
};
