import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, projectDependency, workspace } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject, projectOrgId } from '$lib/server/permissions';
import type { RequestHandler } from './$types';

/** DFS: would adding from→to create a cycle in the dependency graph? */
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

/** GET — the ids of projects this project depends on. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const deps = await db
		.select({ dependsOnId: projectDependency.dependsOnId })
		.from(projectDependency)
		.where(eq(projectDependency.projectId, params.id));
	return json({ dependsOn: deps.map((d) => d.dependsOnId) });
};

/** POST — add a project dependency {dependsOnId} (existence + DFS cycle check). */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't edit — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const dependsOnId = typeof body.dependsOnId === 'string' ? body.dependsOnId.trim() : '';
	if (!dependsOnId || dependsOnId === params.id) return apiError(400, 'Invalid dependency');

	const [target] = await db.select().from(project).where(eq(project.id, dependsOnId));
	// same generic message whether absent or inaccessible — no cross-project oracle
	if (!target || !(await canAccessProject(locals.user, dependsOnId)))
		return apiError(400, 'Unknown project');

	// Same-org only (ADR-062): a user who belongs to BOTH orgs could otherwise wire a
	// dependency across the tenant boundary. Same generic message — no cross-org oracle.
	const [srcOrg, dstOrg] = await Promise.all([projectOrgId(params.id), projectOrgId(dependsOnId)]);
	if (!srcOrg || srcOrg !== dstOrg) return apiError(400, 'Unknown project');

	// Cycle check over THIS org's dependency edges only (edges are same-org by the
	// check above; loading every org's graph would be both incorrect and leaky).
	const all = await db
		.select({ projectId: projectDependency.projectId, dependsOnId: projectDependency.dependsOnId })
		.from(projectDependency)
		.innerJoin(project, eq(projectDependency.projectId, project.id))
		.innerJoin(workspace, eq(project.workspaceId, workspace.id))
		.where(eq(workspace.organizationId, srcOrg));
	const edges = new Map<string, string[]>();
	for (const e of all) edges.set(e.projectId, [...(edges.get(e.projectId) ?? []), e.dependsOnId]);
	if (createsCycle(edges, params.id, dependsOnId))
		return apiError(400, 'That dependency would create a cycle');

	await db
		.insert(projectDependency)
		.values({ projectId: params.id, dependsOnId })
		.onConflictDoNothing();

	broadcastProjectChange(params.id, locals.user.id);
	const deps = await db
		.select({ dependsOnId: projectDependency.dependsOnId })
		.from(projectDependency)
		.where(eq(projectDependency.projectId, params.id));
	return json({ dependsOn: deps.map((d) => d.dependsOnId) }, { status: 201 });
};

/** DELETE — remove a project dependency (?dependsOnId=). */
export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't edit — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const dependsOnId = (url.searchParams.get('dependsOnId') ?? '').trim();
	if (!dependsOnId) return apiError(400, 'dependsOnId is required');

	await db
		.delete(projectDependency)
		.where(
			and(
				eq(projectDependency.projectId, params.id),
				eq(projectDependency.dependsOnId, dependsOnId)
			)
		);

	broadcastProjectChange(params.id, locals.user.id);
	return new Response(null, { status: 204 });
};
