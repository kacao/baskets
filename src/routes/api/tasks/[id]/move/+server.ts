import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessProject } from '$lib/server/permissions';
import { customValuesByTask } from '$lib/server/customFields';
import { moveTaskService } from '$lib/server/tasks';
import type { RequestHandler } from './$types';

// Board-order move (mirrors the moveTask form action): place a top-level task in a
// status column, ordered before `beforeId` (or at the end). This writes task.position —
// the canonical order task lists are returned in — unlike the separate user-facing
// `order` rank settable via PATCH /api/tasks/{id}.
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(task).where(eq(task.id, params.id));
	if (!existing) return apiError(404, 'Task not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, existing.projectId)))
		return apiError(404, 'Task not found');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	// statusId defaults to the current column (reorder-in-place)
	let statusId = existing.statusId;
	if (body.statusId !== undefined) {
		if (typeof body.statusId !== 'string' || !body.statusId)
			return apiError(400, 'statusId must be a non-empty string');
		statusId = body.statusId;
	}

	let beforeId: string | null = null;
	if (body.beforeId !== undefined && body.beforeId !== null && body.beforeId !== '') {
		if (typeof body.beforeId !== 'string')
			return apiError(400, 'beforeId must be a string or null');
		beforeId = body.beforeId;
	}

	const res = await moveTaskService(params.id, existing.projectId, statusId, beforeId, locals.user);
	if (!res.ok) return apiError(res.status, res.message);

	const [moved] = await db.select().from(task).where(eq(task.id, params.id));
	const values = await customValuesByTask(existing.projectId, [params.id]);
	return json({ task: { ...moved, customFields: values[params.id] ?? {} } });
};
