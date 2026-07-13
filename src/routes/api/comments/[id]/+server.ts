import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessProject, projectOrgId } from '$lib/server/permissions';
import { isOrgAdmin } from '$lib/server/orgs';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { deleteComment, getComment, updateComment } from '$lib/server/comments';
import { notifyMentions } from '$lib/server/mentions';
import type { RequestHandler } from './$types';

/** Moderator override: the comment author OR an org admin/owner of the project's org. */
async function canModerate(
	user: NonNullable<App.Locals['user']>,
	authorId: string,
	projectId: string
): Promise<boolean> {
	if (authorId === user.id) return true;
	const orgId = await projectOrgId(projectId);
	return orgId ? isOrgAdmin(user.id, orgId) : false;
}

/** PATCH /api/comments/:id — edit a comment (author or admin). */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const existing = await getComment(params.id);
	if (!existing) return apiError(404, 'Comment not found');

	const [t] = await db
		.select({ projectId: task.projectId })
		.from(task)
		.where(eq(task.id, existing.taskId));
	if (!t || !(await canAccessProject(locals.user, t.projectId)))
		return apiError(404, 'Comment not found');

	if (!(await canModerate(locals.user, existing.authorId, t.projectId)))
		return apiError(403, 'Not your comment');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	const text = typeof body.body === 'string' ? body.body.trim() : '';
	if (!text) return apiError(400, 'body is required');
	if (text.length > 10000) return apiError(400, 'body too long (max 10000)');

	const updated = await updateComment(params.id, text);
	void notifyMentions({
		text,
		prevText: existing.body,
		actorId: locals.user.id,
		actorName: locals.user.name,
		projectId: t.projectId,
		taskId: existing.taskId,
		contextLabel: 'a comment'
	});
	broadcastProjectChange(t.projectId, locals.user.id);
	return json({ comment: updated });
};

/** DELETE /api/comments/:id — delete a comment (author or admin). */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const existing = await getComment(params.id);
	if (!existing) return apiError(404, 'Comment not found');

	const [t] = await db
		.select({ projectId: task.projectId })
		.from(task)
		.where(eq(task.id, existing.taskId));
	if (!t || !(await canAccessProject(locals.user, t.projectId)))
		return apiError(404, 'Comment not found');

	if (!(await canModerate(locals.user, existing.authorId, t.projectId)))
		return apiError(403, 'Not your comment');

	await deleteComment(params.id);
	broadcastProjectChange(t.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
