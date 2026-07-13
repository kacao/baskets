import { json } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, workspace } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { accessibleWorkspaceIds, grantedProjectIds } from '$lib/server/permissions';
import { createWorkspaceService, listUserOrgs } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// ADR-062 D4: union over the caller's memberships of accessible workspaces (incl.
	// ones holding a directly-granted project). Optional ?org= narrows to one org; an
	// unknown/non-member org id yields [] (no oracle).
	const orgFilter = url.searchParams.get('org');
	const orgs = await listUserOrgs(locals.user.id);
	const targetOrgs = orgFilter ? orgs.filter((o) => o.id === orgFilter) : orgs;
	if (targetOrgs.length === 0) return json({ workspaces: [] });

	const visibleWsIds = new Set<string>();
	const grantedProj = new Set<string>();
	for (const o of targetOrgs) {
		(await accessibleWorkspaceIds(locals.user, o.id)).forEach((id) => visibleWsIds.add(id));
		(await grantedProjectIds(locals.user, o.id)).forEach((id) => grantedProj.add(id));
	}
	if (grantedProj.size > 0) {
		const rows = await db
			.select({ workspaceId: project.workspaceId })
			.from(project)
			.where(inArray(project.id, [...grantedProj]));
		for (const r of rows) if (r.workspaceId) visibleWsIds.add(r.workspaceId);
	}
	if (visibleWsIds.size === 0) return json({ workspaces: [] });

	const workspaces = await db
		.select()
		.from(workspace)
		.where(inArray(workspace.id, [...visibleWsIds]));
	return json({ workspaces });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	// resolve the target org: explicit organizationId, else the sole membership;
	// >1 org without an explicit id is ambiguous (400). A nonexistent vs non-member
	// org id both surface identically through createWorkspaceService (no oracle).
	let organizationId = typeof body.organizationId === 'string' ? body.organizationId : '';
	if (!organizationId) {
		const orgs = await listUserOrgs(locals.user.id);
		if (orgs.length === 1) organizationId = orgs[0].id;
		else if (orgs.length === 0) return apiError(400, 'You do not belong to any organization');
		else
			return apiError(400, 'organizationId is required when you belong to multiple organizations');
	}

	const res = await createWorkspaceService({ name, ownerId: locals.user.id, organizationId });
	if (!res.ok) return apiError(res.status, res.message);

	const [created] = await db.select().from(workspace).where(eq(workspace.id, res.data.id));
	return json({ workspace: created }, { status: 201 });
};
