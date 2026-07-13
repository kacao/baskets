import { json } from '@sveltejs/kit';
import { apiError, readJson } from '$lib/server/api';
import { canAccessWorkspace, canEditWorkspace } from '$lib/server/permissions';
import {
	createWorkspaceStatus,
	listWorkspaceStatuses,
	reorderWorkspaceStatuses
} from '$lib/server/statuses';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	// ADR-019: inaccessible workspaces are indistinguishable from missing ones
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');

	const statuses = await listWorkspaceStatuses(params.id);
	return json({ statuses });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	// ADR-019: access/edit gate BEFORE reading the body (no existence oracle).
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');
	if (!(await canEditWorkspace(locals.user, params.id)))
		return apiError(403, 'No edit permission on this workspace');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	// REST keeps its own field-level messages (name/category), so validate here
	// before porting the create logic.
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'name is required');
	if (name.length > 40) return apiError(400, 'name too long (max 40)');

	const description =
		typeof body.description === 'string' && body.description.trim()
			? body.description.trim()
			: null;
	if (description && description.length > 200)
		return apiError(400, 'description too long (max 200)');

	const category = typeof body.category === 'string' ? body.category : 'backlog';

	const res = await createWorkspaceStatus(
		params.id,
		{ name, description, category, color: body.color, icon: body.icon },
		locals.user
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ status: res.data }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	// ADR-019: access/edit gate BEFORE reading the body (no existence oracle).
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');
	if (!(await canEditWorkspace(locals.user, params.id)))
		return apiError(403, 'No edit permission on this workspace');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	if (!Array.isArray(body.order) || !body.order.every((id) => typeof id === 'string'))
		return apiError(400, 'order must be an array of status ids');

	const res = await reorderWorkspaceStatuses(params.id, body.order as string[], locals.user, {
		invalidOrderMessage: 'order must list exactly this workspace’s statuses'
	});
	if (!res.ok) return apiError(res.status, res.message);
	return json({ statuses: res.data });
};
