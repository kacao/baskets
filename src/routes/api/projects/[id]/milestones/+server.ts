import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { milestone, project } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { createMilestone, reorderMilestones } from '$lib/server/milestones';
import type { RequestHandler } from './$types';

/** GET /api/projects/:id/milestones — milestones (position then createdAt). */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const milestones = await db
		.select()
		.from(milestone)
		.where(eq(milestone.projectId, params.id))
		.orderBy(asc(milestone.position), asc(milestone.createdAt));

	return json({ milestones });
};

/** POST /api/projects/:id/milestones — create a milestone (structure edit). */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const res = await createMilestone(
		params.id,
		{
			name: typeof body.name === 'string' ? body.name : '',
			description: body.description as string | null | undefined,
			startDate: body.startDate as string | null | undefined,
			targetDate: body.targetDate as string | null | undefined
		},
		locals.user,
		{ broadcast: true, maxNameLen: 120 }
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ milestone: res.data }, { status: 201 });
};

// Reorder this project's milestones: { order: [ids] } (foreign ids ignored, omitted ones
// keep their relative order after the listed ones). Mirrors the reorderMilestone action.
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	if (!Array.isArray(body.order) || !body.order.every((x) => typeof x === 'string'))
		return apiError(400, 'order must be an array of milestone ids');

	await reorderMilestones(params.id, body.order as string[]);
	broadcastProjectChange(params.id, locals.user.id);
	return json({ success: true });
};
