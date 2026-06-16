import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { activity, comment, task, user } from './db/schema';

export type CommentWithAuthor = {
	id: string;
	taskId: string;
	authorId: string;
	authorName: string | null;
	body: string;
	createdAt: Date;
	updatedAt: Date;
	edited: boolean;
};

export type ActivityWithActor = {
	id: string;
	projectId: string;
	taskId: string | null;
	actorId: string;
	actorName: string | null;
	type: string;
	data: Record<string, unknown>;
	createdAt: Date;
};

/** Comments on a task, oldest first, joined with author name. */
export async function listComments(taskId: string): Promise<CommentWithAuthor[]> {
	const rows = await db
		.select({
			id: comment.id,
			taskId: comment.taskId,
			authorId: comment.authorId,
			authorName: user.name,
			body: comment.body,
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt
		})
		.from(comment)
		.leftJoin(user, eq(user.id, comment.authorId))
		.where(eq(comment.taskId, taskId))
		.orderBy(asc(comment.createdAt));

	return rows.map((r) => ({
		...r,
		edited: r.updatedAt.getTime() - r.createdAt.getTime() > 1000
	}));
}

/** A single comment with author name, or null. */
export async function getComment(id: string): Promise<CommentWithAuthor | null> {
	const [r] = await db
		.select({
			id: comment.id,
			taskId: comment.taskId,
			authorId: comment.authorId,
			authorName: user.name,
			body: comment.body,
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt
		})
		.from(comment)
		.leftJoin(user, eq(user.id, comment.authorId))
		.where(eq(comment.id, id));
	if (!r) return null;
	return { ...r, edited: r.updatedAt.getTime() - r.createdAt.getTime() > 1000 };
}

/** Create a comment on a task; also logs a 'comment' activity entry. */
export async function createComment(
	taskId: string,
	authorId: string,
	body: string
): Promise<CommentWithAuthor> {
	const now = new Date();
	const id = crypto.randomUUID();
	await db.insert(comment).values({ id, taskId, authorId, body, createdAt: now, updatedAt: now });

	const [t] = await db.select({ projectId: task.projectId }).from(task).where(eq(task.id, taskId));
	if (t) {
		await logActivity(t.projectId, taskId, authorId, 'comment', {
			commentId: id,
			excerpt: body.slice(0, 140)
		});
	}

	const created = await getComment(id);
	// getComment can't return null right after insert, but keep the type honest
	return (
		created ?? {
			id,
			taskId,
			authorId,
			authorName: null,
			body,
			createdAt: now,
			updatedAt: now,
			edited: false
		}
	);
}

/** Update a comment body (author-only enforced by the caller). */
export async function updateComment(id: string, body: string): Promise<CommentWithAuthor | null> {
	await db.update(comment).set({ body, updatedAt: new Date() }).where(eq(comment.id, id));
	return getComment(id);
}

/** Delete a comment (author-only enforced by the caller). */
export async function deleteComment(id: string): Promise<void> {
	await db.delete(comment).where(eq(comment.id, id));
}

/** Activity feed for a task (or whole project when taskId omitted), newest first. */
export async function listActivity(
	projectId: string,
	taskId?: string
): Promise<ActivityWithActor[]> {
	const where = taskId
		? and(eq(activity.projectId, projectId), eq(activity.taskId, taskId))
		: eq(activity.projectId, projectId);

	const rows = await db
		.select({
			id: activity.id,
			projectId: activity.projectId,
			taskId: activity.taskId,
			actorId: activity.actorId,
			actorName: user.name,
			type: activity.type,
			data: activity.data,
			createdAt: activity.createdAt
		})
		.from(activity)
		.leftJoin(user, eq(user.id, activity.actorId))
		.where(where)
		.orderBy(desc(activity.createdAt));

	return rows.map((r) => ({
		...r,
		data: parseData(r.data)
	}));
}

function parseData(raw: string): Record<string, unknown> {
	try {
		const v = JSON.parse(raw);
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * Append an entry to the project activity log. Fire-and-forget friendly:
 * callers may `void logActivity(...)`. `data` is serialized to JSON.
 */
export async function logActivity(
	projectId: string,
	taskId: string | null,
	actorId: string,
	type: string,
	data: Record<string, unknown> = {}
): Promise<void> {
	try {
		await db.insert(activity).values({
			id: crypto.randomUUID(),
			projectId,
			taskId,
			actorId,
			type,
			data: JSON.stringify(data ?? {}),
			createdAt: new Date()
		});
	} catch (err) {
		console.error('[activity] log failed:', err);
	}
}
