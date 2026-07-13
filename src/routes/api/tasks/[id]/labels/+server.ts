import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { label, project, task, taskLabel } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditTask } from '$lib/server/permissions';
import type { RequestHandler } from './$types';

/** Loads the task, enforcing access (404) then edit (403). Returns the task or an error Response. */
async function requireEditableTask(
	user: NonNullable<App.Locals['user']>,
	taskId: string
): Promise<{ task: typeof task.$inferSelect } | { error: Response }> {
	const [found] = await db.select().from(task).where(eq(task.id, taskId));
	if (!found) return { error: apiError(404, 'Task not found') };
	// ADR-019: inaccessible projects' tasks are indistinguishable from missing ones
	if (!(await canAccessProject(user, found.projectId)))
		return { error: apiError(404, 'Task not found') };
	if (!(await canEditTask(user, found)))
		return { error: apiError(403, 'No edit permission on this task') };
	return { task: found };
}

/**
 * Validates that `labelId` is attachable to `t`: a workspace label of the task's
 * project's workspace, OR a label scoped to the task's project (mirror toggleTaskLabel).
 */
async function labelIsValid(t: typeof task.$inferSelect, labelId: string): Promise<boolean> {
	const [l] = await db.select().from(label).where(eq(label.id, labelId));
	const [proj] = await db.select().from(project).where(eq(project.id, t.projectId));
	return Boolean(
		l &&
		proj &&
		((l.workspaceId !== null && l.workspaceId === proj.workspaceId) ||
			(l.projectId !== null && l.projectId === t.projectId))
	);
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [found] = await db.select().from(task).where(eq(task.id, params.id));
	if (!found) return apiError(404, 'Task not found');
	// ADR-019: inaccessible projects' tasks are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, found.projectId)))
		return apiError(404, 'Task not found');

	const rows = await db
		.select({ labelId: taskLabel.labelId })
		.from(taskLabel)
		.where(eq(taskLabel.taskId, params.id));
	return json({ labelIds: rows.map((r) => r.labelId) });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const res = await requireEditableTask(locals.user, params.id);
	if ('error' in res) return res.error;
	const t = res.task;

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	const labelId = typeof body.labelId === 'string' ? body.labelId : '';
	if (!labelId) return apiError(400, 'labelId is required');

	if (!(await labelIsValid(t, labelId))) return apiError(400, 'Unknown label');

	await db.insert(taskLabel).values({ taskId: params.id, labelId }).onConflictDoNothing();
	broadcastProjectChange(t.projectId, locals.user.id);

	const rows = await db
		.select({ labelId: taskLabel.labelId })
		.from(taskLabel)
		.where(eq(taskLabel.taskId, params.id));
	return json({ labelIds: rows.map((r) => r.labelId) });
};

export const PUT: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const res = await requireEditableTask(locals.user, params.id);
	if ('error' in res) return res.error;
	const t = res.task;

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	if (!Array.isArray(body.labelIds)) return apiError(400, 'labelIds must be an array');
	if (!body.labelIds.every((x) => typeof x === 'string'))
		return apiError(400, 'labelIds must be an array of strings');
	const labelIds = [...new Set(body.labelIds as string[])];
	if (labelIds.length > 100) return apiError(400, 'Too many labels (max 100)');

	if (labelIds.length > 0) {
		// one query instead of per-id (avoid N+1): a label is valid if it's a workspace
		// label of this project's workspace OR scoped to this project
		const [proj] = await db.select().from(project).where(eq(project.id, t.projectId));
		const found = await db.select().from(label).where(inArray(label.id, labelIds));
		const valid = new Set(
			found
				.filter(
					(l) =>
						proj &&
						((l.workspaceId !== null && l.workspaceId === proj.workspaceId) ||
							(l.projectId !== null && l.projectId === t.projectId))
				)
				.map((l) => l.id)
		);
		const bad = labelIds.find((id) => !valid.has(id));
		if (bad) return apiError(400, `Unknown label: ${bad}`);
	}

	await db.delete(taskLabel).where(eq(taskLabel.taskId, params.id));
	if (labelIds.length > 0)
		await db.insert(taskLabel).values(labelIds.map((labelId) => ({ taskId: params.id, labelId })));
	broadcastProjectChange(t.projectId, locals.user.id);

	const rows = await db
		.select({ labelId: taskLabel.labelId })
		.from(taskLabel)
		.where(eq(taskLabel.taskId, params.id));
	return json({ labelIds: rows.map((r) => r.labelId) });
};

export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const res = await requireEditableTask(locals.user, params.id);
	if ('error' in res) return res.error;
	const t = res.task;

	const labelId = url.searchParams.get('labelId') ?? '';
	if (!labelId) return apiError(400, 'labelId query parameter is required');

	await db
		.delete(taskLabel)
		.where(and(eq(taskLabel.taskId, params.id), eq(taskLabel.labelId, labelId)));
	broadcastProjectChange(t.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
