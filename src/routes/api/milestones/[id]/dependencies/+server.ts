import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { milestone, milestoneDependency } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import type { RequestHandler } from './$types';

/** DFS cycle check (ported from the project page's createsCycle): would from→to close a loop? */
function createsCycle(edges: Map<string, string[]>, from: string, to: string) {
	const stack = [to];
	const seen = new Set<string>();
	while (stack.length) {
		const cur = stack.pop()!;
		if (cur === from) return true;
		if (seen.has(cur)) continue;
		seen.add(cur);
		for (const next of edges.get(cur) ?? []) stack.push(next);
	}
	return false;
}

/** All dependency edges among a project's milestones as an adjacency map. */
async function projectEdges(projectId: string) {
	const all = await db
		.select({
			milestoneId: milestoneDependency.milestoneId,
			dependsOnId: milestoneDependency.dependsOnId
		})
		.from(milestoneDependency)
		.innerJoin(milestone, eq(milestoneDependency.milestoneId, milestone.id))
		.where(eq(milestone.projectId, projectId));
	const edges = new Map<string, string[]>();
	for (const e of all) edges.set(e.milestoneId, [...(edges.get(e.milestoneId) ?? []), e.dependsOnId]);
	return edges;
}

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

	const [ms] = await db.select().from(milestone).where(eq(milestone.id, params.id));
	if (!ms) return apiError(404, 'Milestone not found');
	if (!(await canAccessProject(locals.user, ms.projectId)))
		return apiError(404, 'Milestone not found');
	if (!(await canEditProject(locals.user, ms.projectId)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const dependsOnId = typeof body.dependsOnId === 'string' ? body.dependsOnId : '';
	if (!dependsOnId) return apiError(400, 'dependsOnId is required');
	if (dependsOnId === params.id) return apiError(400, 'A milestone cannot depend on itself');

	const [dep] = await db.select().from(milestone).where(eq(milestone.id, dependsOnId));
	if (!dep || dep.projectId !== ms.projectId)
		return apiError(400, 'Both milestones must belong to this project');

	const edges = await projectEdges(ms.projectId);
	if (createsCycle(edges, params.id, dependsOnId))
		return apiError(400, 'That dependency would create a cycle');

	await db
		.insert(milestoneDependency)
		.values({ milestoneId: params.id, dependsOnId })
		.onConflictDoNothing();

	broadcastProjectChange(ms.projectId, locals.user.id);
	return json({ success: true }, { status: 201 });
};

/** PUT /api/milestones/:id/dependencies — replace the full set { dependsOnIds } (cycle-skipped). */
export const PUT: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [ms] = await db.select().from(milestone).where(eq(milestone.id, params.id));
	if (!ms) return apiError(404, 'Milestone not found');
	if (!(await canAccessProject(locals.user, ms.projectId)))
		return apiError(404, 'Milestone not found');
	if (!(await canEditProject(locals.user, ms.projectId)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	if (!Array.isArray(body.dependsOnIds)) return apiError(400, 'dependsOnIds must be an array');

	const projectMs = await db
		.select({ id: milestone.id })
		.from(milestone)
		.where(eq(milestone.projectId, ms.projectId));
	const validIds = new Set(projectMs.map((r) => r.id));
	const desired = [...new Set(body.dependsOnIds.map((v) => String(v)))].filter(
		(id) => id && id !== params.id && validIds.has(id)
	);

	// edges minus this milestone's current deps; re-add desired one by one, skipping cycles
	const edges = await projectEdges(ms.projectId);
	edges.delete(params.id);

	const accepted: string[] = [];
	for (const dep of desired) {
		if (createsCycle(edges, params.id, dep)) continue;
		accepted.push(dep);
		edges.set(params.id, [...(edges.get(params.id) ?? []), dep]);
	}

	await db.delete(milestoneDependency).where(eq(milestoneDependency.milestoneId, params.id));
	if (accepted.length)
		await db
			.insert(milestoneDependency)
			.values(accepted.map((dependsOnId) => ({ milestoneId: params.id, dependsOnId })))
			.onConflictDoNothing();

	broadcastProjectChange(ms.projectId, locals.user.id);
	return json({ dependsOnIds: accepted });
};

/** DELETE /api/milestones/:id/dependencies?dependsOnId=... — remove one edge. */
export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [ms] = await db.select().from(milestone).where(eq(milestone.id, params.id));
	if (!ms) return apiError(404, 'Milestone not found');
	if (!(await canAccessProject(locals.user, ms.projectId)))
		return apiError(404, 'Milestone not found');
	if (!(await canEditProject(locals.user, ms.projectId)))
		return apiError(403, 'No edit permission on this project');

	const dependsOnId = url.searchParams.get('dependsOnId') ?? '';
	if (!dependsOnId) return apiError(400, 'dependsOnId query parameter is required');

	await db
		.delete(milestoneDependency)
		.where(
			and(
				eq(milestoneDependency.milestoneId, params.id),
				eq(milestoneDependency.dependsOnId, dependsOnId)
			)
		);

	broadcastProjectChange(ms.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
