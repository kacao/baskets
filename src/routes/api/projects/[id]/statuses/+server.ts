import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import {
	createProjectStatus,
	listProjectStatuses,
	reorderProjectStatuses,
	setProjectEligibleStatuses
} from '$lib/server/statuses';
import type { RequestHandler } from './$types';

/** GET — the project's eligible (assignable-on-tasks) statuses, in global order. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const statuses = await listProjectStatuses(params.id);
	return json({ statuses });
};

/** POST — create a PROJECT-scoped status (mirrors the createStatus form action). */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: gate BEFORE reading the body — 404, not 403, for inaccessible
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const res = await createProjectStatus(
		params.id,
		{
			name: typeof body.name === 'string' ? body.name : '',
			description: typeof body.description === 'string' ? body.description : null,
			category: typeof body.category === 'string' ? body.category : 'backlog',
			color: body.color,
			icon: body.icon
		},
		locals.user,
		{ broadcast: true }
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ status: res.data }, { status: 201 });
};

/**
 * PATCH — set the eligible status id set (statusIds) and/or reorder this project's
 * custom statuses (order). Mirrors the updateProjectStatuses + reorderStatus actions.
 */
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: gate BEFORE reading the body — 404, not 403, for inaccessible
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const hasStatusIds = body.statusIds !== undefined;
	const hasOrder = body.order !== undefined;
	if (!hasStatusIds && !hasOrder) return apiError(400, 'Provide statusIds and/or order');

	// --- reorder this project's custom statuses (positions only; category unchanged) ---
	if (hasOrder) {
		if (!Array.isArray(body.order) || !body.order.every((v) => typeof v === 'string'))
			return apiError(400, 'order must be an array of status ids');
		const res = await reorderProjectStatuses(params.id, body.order as string[], locals.user);
		if (!res.ok) return apiError(res.status, res.message);
	}

	// --- set the eligible status id set ---
	if (hasStatusIds) {
		if (!Array.isArray(body.statusIds) || !body.statusIds.every((v) => typeof v === 'string'))
			return apiError(400, 'statusIds must be an array of status ids');
		const res = await setProjectEligibleStatuses(params.id, body.statusIds as string[], locals.user);
		if (!res.ok) return apiError(res.status, res.message);
	}

	broadcastProjectChange(params.id, locals.user.id);
	const statuses = await listProjectStatuses(params.id);
	return json({ statuses });
};
