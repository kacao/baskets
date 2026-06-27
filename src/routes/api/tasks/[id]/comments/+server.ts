import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessProject } from '$lib/server/permissions';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { createComment, listActivity, listComments } from '$lib/server/comments';
import { notifyMentions } from '$lib/server/mentions';
import type { RequestHandler } from './$types';

/** GET /api/tasks/:id/comments — comments (oldest first) + task activity (newest first). */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [found] = await db.select().from(task).where(eq(task.id, params.id));
	if (!found) return apiError(404, 'Task not found');
	// ADR-019: inaccessible projects' tasks are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, found.projectId)))
		return apiError(404, 'Task not found');

	const [comments, activity] = await Promise.all([
		listComments(params.id),
		listActivity(found.projectId, params.id)
	]);
	return json({ comments, activity });
};

/** POST /api/tasks/:id/comments — add a comment (any project member). */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [found] = await db.select().from(task).where(eq(task.id, params.id));
	if (!found) return apiError(404, 'Task not found');
	if (!(await canAccessProject(locals.user, found.projectId)))
		return apiError(404, 'Task not found');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const text = typeof body.body === 'string' ? body.body.trim() : '';
	if (!text) return apiError(400, 'body is required');
	if (text.length > 10000) return apiError(400, 'body too long (max 10000)');

	const created = await createComment(params.id, locals.user.id, text);
	void notifyMentions({
		text,
		actorId: locals.user.id,
		actorName: locals.user.name,
		projectId: found.projectId,
		taskId: params.id,
		contextLabel: `a comment on "${found.title}"`
	});
	broadcastProjectChange(found.projectId, locals.user.id);
	return json({ comment: created }, { status: 201 });
};
