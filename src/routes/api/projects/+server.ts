import { json } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, workspace } from '$lib/server/db/schema';
import { apiError, readJson, optionalString, ApiValidationError } from '$lib/server/api';
import { dispatchEvent } from '$lib/server/integrations';
import {
	accessibleWorkspaceIds,
	canEditWorkspace,
	grantedProjectIds
} from '$lib/server/permissions';
import { createProjectWithDefaults } from '$lib/server/projects';
import { listUserOrgs } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// ADR-062 D4: union over the caller's memberships of the per-org ACCESS-FILTERED
	// sets — never raw org contents. Optional ?org= narrows to one org (an unknown or
	// non-member org id yields [] with no oracle).
	const orgFilter = url.searchParams.get('org');
	const orgs = await listUserOrgs(locals.user.id);
	const targetOrgs = orgFilter ? orgs.filter((o) => o.id === orgFilter) : orgs;
	if (targetOrgs.length === 0) return json({ projects: [] });

	const accWs = new Set<string>();
	const grantedProj = new Set<string>();
	for (const o of targetOrgs) {
		(await accessibleWorkspaceIds(locals.user, o.id)).forEach((id) => accWs.add(id));
		(await grantedProjectIds(locals.user, o.id)).forEach((id) => grantedProj.add(id));
	}
	const wsIds = [...accWs];
	const pIds = [...grantedProj];
	if (wsIds.length === 0 && pIds.length === 0) return json({ projects: [] });

	const conds = [];
	if (wsIds.length) conds.push(inArray(project.workspaceId, wsIds));
	if (pIds.length) conds.push(inArray(project.id, pIds));
	const projects = await db
		.select()
		.from(project)
		.where(or(...conds))
		.orderBy(desc(project.createdAt));
	return json({ projects });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'name is required');
	if (name.length > 120) return apiError(400, 'name too long (max 120)');

	let description: string | null;
	let workspaceId: string;
	let organizationId: string;
	try {
		description = optionalString(body.description, 'description');
		workspaceId = optionalString(body.workspaceId, 'workspaceId') ?? '';
		organizationId = optionalString(body.organizationId, 'organizationId') ?? '';
	} catch (err) {
		if (err instanceof ApiValidationError) return apiError(400, err.message);
		throw err;
	}

	if (workspaceId) {
		// canEditWorkspace collapses "no such workspace in your orgs" and "no edit
		// permission" into one false — a single 400 keeps existence non-probeable.
		if (!(await canEditWorkspace(locals.user, workspaceId)))
			return apiError(400, 'Cannot create a project in that workspace');
	} else {
		// Default: oldest ACCESSIBLE workspace in the specified/sole org (no cookie on
		// bearer requests). Unknown/non-member org id → same generic 400 (no oracle).
		const orgs = await listUserOrgs(locals.user.id);
		if (organizationId) {
			if (!orgs.some((o) => o.id === organizationId))
				return apiError(400, 'no accessible workspace to create a project in');
		} else if (orgs.length === 1) {
			organizationId = orgs[0].id;
		} else if (orgs.length === 0) {
			return apiError(400, 'no accessible workspace to create a project in');
		} else {
			return apiError(400, 'organizationId is required when you belong to multiple organizations');
		}
		const accWs = await accessibleWorkspaceIds(locals.user, organizationId);
		if (accWs.size === 0) return apiError(400, 'no accessible workspace to create a project in');
		const [ws] = await db
			.select({ id: workspace.id })
			.from(workspace)
			.where(and(eq(workspace.organizationId, organizationId), inArray(workspace.id, [...accWs])))
			.orderBy(asc(workspace.createdAt))
			.limit(1);
		if (!ws) return apiError(400, 'no accessible workspace to create a project in');
		workspaceId = ws.id;
	}

	const id = await createProjectWithDefaults({
		name,
		description,
		workspaceId,
		creator: locals.user
	});
	const [created] = await db.select().from(project).where(eq(project.id, id));

	void dispatchEvent({
		type: 'project.created',
		actor: locals.user.name,
		projectName: name,
		projectId: id
	});

	return json({ project: created }, { status: 201 });
};
