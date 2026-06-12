import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { milestone, project, task } from '$lib/server/db/schema';
import {
	apiError,
	readJson,
	optionalString,
	ApiValidationError,
	PRIORITIES
} from '$lib/server/api';
import { dispatchEvent } from '$lib/server/integrations';
import { canEditTask } from '$lib/server/permissions';
import { listProjectStatuses } from '$lib/server/statuses';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [found] = await db.select().from(task).where(eq(task.id, params.id));
	if (!found) return apiError(404, 'Task not found');

	const subTasks = await db
		.select()
		.from(task)
		.where(eq(task.parentId, params.id))
		.orderBy(asc(task.position), asc(task.createdAt));

	return json({ task: found, subTasks });
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(task).where(eq(task.id, params.id));
	if (!existing) return apiError(404, 'Task not found');
	if (!(await canEditTask(locals.user, existing)))
		return apiError(403, 'No edit permission on this task');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const eligible = await listProjectStatuses(existing.projectId);
	const updates: Partial<typeof task.$inferInsert> = {};
	let targetStatus: (typeof eligible)[number] | undefined;

	if (body.title !== undefined) {
		const title = typeof body.title === 'string' ? body.title.trim() : '';
		if (!title) return apiError(400, 'title cannot be empty');
		if (title.length > 240) return apiError(400, 'title too long (max 240)');
		updates.title = title;
	}

	if (body.statusId !== undefined || body.status !== undefined) {
		targetStatus =
			typeof body.statusId === 'string'
				? eligible.find((s) => s.id === body.statusId)
				: typeof body.status === 'string'
					? eligible.find((s) => s.name.toLowerCase() === (body.status as string).toLowerCase())
					: undefined;
		if (!targetStatus)
			return apiError(400, `status must be one of: ${eligible.map((s) => s.name).join(', ')}`);
		updates.statusId = targetStatus.id;
	}

	if (body.priority !== undefined) {
		if (!PRIORITIES.includes(body.priority as (typeof PRIORITIES)[number]))
			return apiError(400, `priority must be one of: ${PRIORITIES.join(', ')}`);
		updates.priority = body.priority as string;
	}

	if (body.description !== undefined) {
		try {
			updates.description = optionalString(body.description, 'description');
		} catch (err) {
			if (err instanceof ApiValidationError) return apiError(400, err.message);
			throw err;
		}
	}

	if (body.assigneeId !== undefined) {
		updates.assigneeId =
			typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null;
	}

	if (body.milestoneId !== undefined) {
		if (body.milestoneId === null || body.milestoneId === '') {
			updates.milestoneId = null;
		} else if (typeof body.milestoneId === 'string') {
			const [m] = await db.select().from(milestone).where(eq(milestone.id, body.milestoneId));
			if (!m || m.projectId !== existing.projectId)
				return apiError(400, 'milestoneId must reference a milestone of the same project');
			updates.milestoneId = body.milestoneId;
		} else {
			return apiError(400, 'milestoneId must be a string or null');
		}
	}

	if (body.location !== undefined) {
		updates.location =
			typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null;
	}

	if (body.dueDate !== undefined) {
		if (body.dueDate === null || body.dueDate === '') {
			updates.dueDate = null;
		} else if (typeof body.dueDate === 'string') {
			const dueDate = new Date(
				body.dueDate.includes('T') ? body.dueDate : body.dueDate + 'T00:00:00'
			);
			if (isNaN(dueDate.getTime())) return apiError(400, 'dueDate must be a valid date');
			updates.dueDate = dueDate;
		} else {
			return apiError(400, 'dueDate must be a string or null');
		}
	}

	if (Object.keys(updates).length === 0) return apiError(400, 'No fields to update');

	const [updated] = await db
		.update(task)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(task.id, params.id))
		.returning();

	// Completing a parent completes its sub-tasks (same rule as the form action)
	const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'done';
	if (targetStatus?.category === 'done' && !wasDone) {
		await db
			.update(task)
			.set({ statusId: targetStatus.id, updatedAt: new Date() })
			.where(eq(task.parentId, params.id));

		const [proj] = await db.select().from(project).where(eq(project.id, existing.projectId));
		void dispatchEvent({
			type: 'task.completed',
			actor: locals.user.name,
			projectName: proj?.name ?? 'Unknown project',
			taskTitle: updated.title
		});
	}

	return json({ task: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(task).where(eq(task.id, params.id));
	if (!existing) return apiError(404, 'Task not found');
	if (!(await canEditTask(locals.user, existing)))
		return apiError(403, 'No edit permission on this task');

	await db.delete(task).where(eq(task.parentId, params.id));
	await db.delete(task).where(eq(task.id, params.id));
	return new Response(null, { status: 204 });
};
