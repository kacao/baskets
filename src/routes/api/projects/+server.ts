import { json } from '@sveltejs/kit';
import { asc, desc, eq } from 'drizzle-orm';
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
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const all = await db.select().from(project).orderBy(desc(project.createdAt));
	const [wsAccess, projGrants] = await Promise.all([
		accessibleWorkspaceIds(locals.user),
		grantedProjectIds(locals.user)
	]);
	const projects =
		wsAccess === 'all'
			? all
			: all.filter((p) => (p.workspaceId && wsAccess.has(p.workspaceId)) || projGrants.has(p.id));
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
	try {
		description = optionalString(body.description, 'description');
	} catch (err) {
		if (err instanceof ApiValidationError) return apiError(400, err.message);
		throw err;
	}

	// optional workspaceId — defaults to the oldest workspace
	let workspaceId: string;
	try {
		workspaceId = optionalString(body.workspaceId, 'workspaceId') ?? '';
	} catch (err) {
		if (err instanceof ApiValidationError) return apiError(400, err.message);
		throw err;
	}
	if (workspaceId) {
		const [ws] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
		if (!ws) return apiError(400, 'unknown workspaceId');
	} else {
		const [ws] = await db
			.select({ id: workspace.id })
			.from(workspace)
			.orderBy(asc(workspace.createdAt))
			.limit(1);
		if (!ws) return apiError(400, 'no workspace exists yet');
		workspaceId = ws.id;
	}

	if (!(await canEditWorkspace(locals.user, workspaceId)))
		return apiError(403, 'No permission to create projects in this workspace');

	const id = await createProjectWithDefaults({
		name,
		description,
		workspaceId,
		creator: locals.user
	});
	const [created] = await db.select().from(project).where(eq(project.id, id));

	void dispatchEvent({ type: 'project.created', actor: locals.user.name, projectName: name });

	return json({ project: created }, { status: 201 });
};
