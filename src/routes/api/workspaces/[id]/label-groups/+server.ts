import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { labelGroup, workspace } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessWorkspace, canEditWorkspace } from '$lib/server/permissions';
import { createLabelGroup } from '$lib/server/labels';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [ws] = await db.select().from(workspace).where(eq(workspace.id, params.id));
	if (!ws) return apiError(404, 'Workspace not found');
	// ADR-019: inaccessible workspaces are indistinguishable from missing ones
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');

	const groups = await db
		.select()
		.from(labelGroup)
		.where(eq(labelGroup.workspaceId, params.id))
		.orderBy(asc(labelGroup.position), asc(labelGroup.name));
	return json({ groups });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [ws] = await db.select().from(workspace).where(eq(workspace.id, params.id));
	if (!ws) return apiError(404, 'Workspace not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');
	if (!(await canEditWorkspace(locals.user, params.id)))
		return apiError(403, 'No edit permission on this workspace');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const res = await createLabelGroup(
		params.id,
		typeof body.name === 'string' ? body.name : '',
		locals.user
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ group: res.data }, { status: 201 });
};
