import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { task, taskDependency } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditTask } from '$lib/server/permissions';
import type { RequestHandler } from './$types';

/** DFS cycle check: would adding from -> to make `to` reach back to `from`? */
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

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [found] = await db.select().from(task).where(eq(task.id, params.id));
	if (!found) return apiError(404, 'Task not found');
	// ADR-019: inaccessible projects' tasks are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, found.projectId)))
		return apiError(404, 'Task not found');

	const rows = await db
		.select({ dependsOnId: taskDependency.dependsOnId })
		.from(taskDependency)
		.where(eq(taskDependency.taskId, params.id));
	return json({ dependsOnIds: rows.map((r) => r.dependsOnId) });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [t] = await db.select().from(task).where(eq(task.id, params.id));
	if (!t) return apiError(404, 'Task not found');
	// ADR-019: inaccessible projects' tasks are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, t.projectId)))
		return apiError(404, 'Task not found');
	if (!(await canEditTask(locals.user, t)))
		return apiError(403, 'No edit permission on this task');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	const dependsOnId = typeof body.dependsOnId === 'string' ? body.dependsOnId : '';
	if (!dependsOnId) return apiError(400, 'dependsOnId is required');
	if (dependsOnId === params.id) return apiError(400, 'A task cannot depend on itself');

	const [dep] = await db.select().from(task).where(eq(task.id, dependsOnId));
	if (!dep || dep.projectId !== t.projectId)
		return apiError(400, 'Both tasks must belong to this project');

	// Sub-tasks may only depend on sibling sub-tasks; top-level on top-level
	if ((t.parentId || dep.parentId) && t.parentId !== dep.parentId)
		return apiError(400, 'Sub-tasks can only depend on sub-tasks of the same task');

	const all = await db
		.select({ taskId: taskDependency.taskId, dependsOnId: taskDependency.dependsOnId })
		.from(taskDependency)
		.innerJoin(task, eq(taskDependency.taskId, task.id))
		.where(eq(task.projectId, t.projectId));
	const edges = new Map<string, string[]>();
	for (const e of all) edges.set(e.taskId, [...(edges.get(e.taskId) ?? []), e.dependsOnId]);
	if (createsCycle(edges, params.id, dependsOnId))
		return apiError(400, 'That dependency would create a cycle');

	await db
		.insert(taskDependency)
		.values({ taskId: params.id, dependsOnId })
		.onConflictDoNothing();
	broadcastProjectChange(t.projectId, locals.user.id);

	const rows = await db
		.select({ dependsOnId: taskDependency.dependsOnId })
		.from(taskDependency)
		.where(eq(taskDependency.taskId, params.id));
	return json({ dependsOnIds: rows.map((r) => r.dependsOnId) }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [t] = await db.select().from(task).where(eq(task.id, params.id));
	if (!t) return apiError(404, 'Task not found');
	// ADR-019: inaccessible projects' tasks are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, t.projectId)))
		return apiError(404, 'Task not found');
	if (!(await canEditTask(locals.user, t)))
		return apiError(403, 'No edit permission on this task');

	const dependsOnId = url.searchParams.get('dependsOnId') ?? '';
	if (!dependsOnId) return apiError(400, 'dependsOnId query parameter is required');

	await db
		.delete(taskDependency)
		.where(
			and(eq(taskDependency.taskId, params.id), eq(taskDependency.dependsOnId, dependsOnId))
		);
	broadcastProjectChange(t.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
