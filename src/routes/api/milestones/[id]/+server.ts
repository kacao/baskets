import { json } from '@sveltejs/kit';
import { apiError, readJson } from '$lib/server/api';
import { deleteMilestoneById, updateMilestoneById } from '$lib/server/milestones';
import type { RequestHandler } from './$types';

/** PATCH /api/milestones/:id — update name/description/startDate/targetDate (structure edit). */
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const res = await updateMilestoneById(
		params.id,
		{
			name: typeof body.name === 'string' ? body.name : undefined,
			description: body.description as string | null | undefined,
			startDate: body.startDate as string | null | undefined,
			targetDate: body.targetDate as string | null | undefined
		},
		locals.user,
		{ has: (key) => body[key] !== undefined, broadcast: true, maxNameLen: 120 }
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ milestone: res.data });
};

/** DELETE /api/milestones/:id — delete a milestone (structure edit). */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const res = await deleteMilestoneById(params.id, locals.user, { broadcast: true });
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
