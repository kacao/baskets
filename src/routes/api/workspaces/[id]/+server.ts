import { json } from '@sveltejs/kit';
import { and, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { permission, project, workspace } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessWorkspace, canEditWorkspace } from '$lib/server/permissions';
import { getWorkspace } from '$lib/server/workspaces';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const ws = await getWorkspace(params.id);
	if (!ws) return apiError(404, 'Workspace not found');
	// ADR-019: inaccessible workspaces are indistinguishable from missing ones
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');

	return json({ workspace: ws });
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const ws = await getWorkspace(params.id);
	if (!ws) return apiError(404, 'Workspace not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');
	if (!(await canEditWorkspace(locals.user, params.id)))
		return apiError(403, 'No edit permission on this workspace');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	if (body.name === undefined) return apiError(400, 'No fields to update');
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'name cannot be empty');
	if (name.length > 120) return apiError(400, 'name too long (max 120)');

	const others = await db.select({ id: workspace.id, name: workspace.name }).from(workspace);
	if (others.some((w) => w.id !== params.id && w.name.toLowerCase() === name.toLowerCase()))
		return apiError(400, 'A workspace with that name already exists');

	const [updated] = await db
		.update(workspace)
		.set({ name, updatedAt: new Date() })
		.where(eq(workspace.id, params.id))
		.returning();

	return json({ workspace: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const ws = await getWorkspace(params.id);
	if (!ws) return apiError(404, 'Workspace not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');
	if (!(await canEditWorkspace(locals.user, params.id)))
		return apiError(403, 'No edit permission on this workspace');

	const [{ n }] = await db
		.select({ n: count(project.id) })
		.from(project)
		.where(eq(project.workspaceId, params.id));
	if (n > 0) return apiError(400, 'Move or delete its projects first');

	const [{ n: total }] = await db.select({ n: count(workspace.id) }).from(workspace);
	if (total <= 1) return apiError(400, 'At least one workspace must exist');

	// permission.resourceId has no FK — clear workspace grants so a future
	// workspace reusing this id (e.g. workspace-default) can't inherit them
	await db
		.delete(permission)
		.where(and(eq(permission.resourceType, 'workspace'), eq(permission.resourceId, params.id)));
	await db.delete(workspace).where(eq(workspace.id, params.id));

	return new Response(null, { status: 204 });
};
