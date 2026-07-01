import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { milestone, milestoneDependency } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessProject } from '$lib/server/permissions';
import { addMilestoneDep, removeMilestoneDep, setMilestoneDeps } from '$lib/server/milestones';
import type { RequestHandler } from './$types';

/** GET /api/milestones/:id/dependencies — this milestone's dependency ids (access only). */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [ms] = await db.select().from(milestone).where(eq(milestone.id, params.id));
	if (!ms) return apiError(404, 'Milestone not found');
	if (!(await canAccessProject(locals.user, ms.projectId)))
		return apiError(404, 'Milestone not found');

	const rows = await db
		.select({ dependsOnId: milestoneDependency.dependsOnId })
		.from(milestoneDependency)
		.where(eq(milestoneDependency.milestoneId, params.id));

	return json({ dependsOnIds: rows.map((r) => r.dependsOnId) });
};

/** POST /api/milestones/:id/dependencies — add one { dependsOnId } (same project, cycle-checked). */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const dependsOnId = typeof body.dependsOnId === 'string' ? body.dependsOnId : '';
	const res = await addMilestoneDep(params.id, dependsOnId, locals.user, { broadcast: true });
	if (!res.ok) return apiError(res.status, res.message);
	return json({ success: true }, { status: 201 });
};

/** PUT /api/milestones/:id/dependencies — replace the full set { dependsOnIds } (cycle-skipped). */
export const PUT: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	if (!Array.isArray(body.dependsOnIds)) return apiError(400, 'dependsOnIds must be an array');

	const res = await setMilestoneDeps(
		params.id,
		body.dependsOnIds.map((v) => String(v)),
		locals.user,
		{ broadcast: true }
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ dependsOnIds: res.data });
};

/** DELETE /api/milestones/:id/dependencies?dependsOnId=... — remove one edge. */
export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const dependsOnId = url.searchParams.get('dependsOnId') ?? '';
	const res = await removeMilestoneDep(params.id, dependsOnId, locals.user, { broadcast: true });
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
