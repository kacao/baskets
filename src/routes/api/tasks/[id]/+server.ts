import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { file, location, milestone, project, task, user } from '$lib/server/db/schema';
import {
	apiError,
	readJson,
	optionalString,
	ApiValidationError,
	PRIORITIES
} from '$lib/server/api';
import { isValidRecurrence, nextDueDate } from '$lib/recurrence';
import { dispatchEvent } from '$lib/server/integrations';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { create as createNotification } from '$lib/server/notifications';
import { canAccessProject, canEditTask } from '$lib/server/permissions';
import { listProjectStatuses } from '$lib/server/statuses';
import {
	apiCustomFieldEntries,
	customValuesByTask,
	writeTaskCustomValues
} from '$lib/server/customFields';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [found] = await db.select().from(task).where(eq(task.id, params.id));
	if (!found) return apiError(404, 'Task not found');
	// ADR-019: inaccessible projects' tasks are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, found.projectId)))
		return apiError(404, 'Task not found');

	const subTasks = await db
		.select()
		.from(task)
		.where(eq(task.parentId, params.id))
		.orderBy(asc(task.position), asc(task.createdAt));

	const values = await customValuesByTask(found.projectId, [found.id]);
	return json({ task: { ...found, customFields: values[found.id] ?? {} }, subTasks });
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(task).where(eq(task.id, params.id));
	if (!existing) return apiError(404, 'Task not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, existing.projectId)))
		return apiError(404, 'Task not found');
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

	let newAssigneeId: string | null | undefined;
	if (body.assigneeId !== undefined) {
		newAssigneeId =
			typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null;
		if (newAssigneeId) {
			const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, newAssigneeId));
			if (!u) return apiError(400, 'assigneeId must reference a valid user');
		}
		updates.assigneeId = newAssigneeId;
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

	if (body.locationId !== undefined) {
		if (body.locationId === null || body.locationId === '') {
			updates.locationId = null;
		} else if (typeof body.locationId === 'string') {
			const [l] = await db.select().from(location).where(eq(location.id, body.locationId));
			if (!l || l.projectId !== existing.projectId)
				return apiError(400, 'locationId must reference a location of the same project');
			updates.locationId = body.locationId;
		} else {
			return apiError(400, 'locationId must be a string or null');
		}
	}

	if (body.location !== undefined) {
		updates.location =
			typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null;
	}

	if (body.order !== undefined) {
		if (body.order === null) {
			updates.order = null;
		} else if (typeof body.order === 'number' && Number.isInteger(body.order)) {
			updates.order = body.order;
		} else {
			return apiError(400, 'order must be an integer or null');
		}
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

	if (body.startDate !== undefined) {
		if (body.startDate === null || body.startDate === '') {
			updates.startDate = null;
		} else if (typeof body.startDate === 'string') {
			const startDate = new Date(
				body.startDate.includes('T') ? body.startDate : body.startDate + 'T00:00:00'
			);
			if (isNaN(startDate.getTime())) return apiError(400, 'startDate must be a valid date');
			updates.startDate = startDate;
		} else {
			return apiError(400, 'startDate must be a string or null');
		}
	}

	if (body.recurrence !== undefined) {
		if (body.recurrence === null || body.recurrence === '') {
			updates.recurrence = null;
		} else if (typeof body.recurrence === 'string') {
			const rule = body.recurrence.trim();
			if (!isValidRecurrence(rule)) return apiError(400, 'Invalid recurrence rule');
			updates.recurrence = rule;
		} else {
			return apiError(400, 'recurrence must be a string or null');
		}
	}

	// coverFileId: must reference an image file attached to THIS task (mirror setTaskCover)
	if (body.coverFileId !== undefined) {
		if (body.coverFileId === null || body.coverFileId === '') {
			updates.coverFileId = null;
		} else if (typeof body.coverFileId === 'string') {
			const [f] = await db.select().from(file).where(eq(file.id, body.coverFileId));
			if (!f || f.taskId !== params.id || f.projectId !== existing.projectId)
				return apiError(400, 'coverFileId must reference a file attached to this task');
			if (!f.mimeType.startsWith('image/')) return apiError(400, 'cover must be an image');
			updates.coverFileId = body.coverFileId;
		} else {
			return apiError(400, 'coverFileId must be a string or null');
		}
	}

	// re-parent: move under another task, or null/"" to make it top-level. Depth-1 only.
	if (body.parentId !== undefined) {
		if (body.parentId === null || body.parentId === '') {
			updates.parentId = null;
		} else if (typeof body.parentId === 'string') {
			if (body.parentId === params.id) return apiError(400, 'a task cannot be its own parent');
			const [parent] = await db.select().from(task).where(eq(task.id, body.parentId));
			if (!parent || parent.projectId !== existing.projectId)
				return apiError(400, 'parentId must reference a task of the same project');
			if (parent.parentId) return apiError(400, 'sub-tasks cannot have sub-tasks');
			const kids = await db
				.select({ id: task.id })
				.from(task)
				.where(eq(task.parentId, params.id));
			if (kids.length > 0) return apiError(400, "move or remove this task's sub-tasks first");
			updates.parentId = body.parentId;
		} else {
			return apiError(400, 'parentId must be a string or null');
		}
	}

	const cfMap =
		body.customFields && typeof body.customFields === 'object' && !Array.isArray(body.customFields)
			? (body.customFields as Record<string, unknown>)
			: null;
	if (Object.keys(updates).length === 0 && !cfMap) return apiError(400, 'No fields to update');

	// Write custom values FIRST so a CF validation error doesn't leave the task
	// row partially updated with no rollback (no surrounding transaction).
	if (cfMap) {
		const res = await writeTaskCustomValues(params.id, existing.projectId, apiCustomFieldEntries(cfMap));
		if (res.error) return apiError(400, res.error);
	}

	const [updated] = await db
		.update(task)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(task.id, params.id))
		.returning();

	// Completing a parent completes its sub-tasks (same rule as the form action)
	const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
	if (targetStatus?.category === 'completed' && !wasDone) {
		// Recurring task: spawn the next occurrence (mirror the setStatus form action)
		if (existing.recurrence) {
			const nextDue = nextDueDate(existing.dueDate ?? new Date(), existing.recurrence);
			const backlog = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
			if (backlog) {
				const spawnNow = new Date();
				await db.insert(task).values({
					id: crypto.randomUUID(),
					projectId: existing.projectId,
					parentId: existing.parentId,
					title: existing.title,
					description: existing.description,
					priority: existing.priority,
					statusId: backlog.id,
					assigneeId: existing.assigneeId,
					milestoneId: existing.milestoneId,
					locationId: existing.locationId,
					startDate: existing.startDate,
					dueDate: nextDue,
					recurrence: existing.recurrence,
					createdBy: locals.user.id,
					position: spawnNow.getTime(),
					createdAt: spawnNow,
					updatedAt: spawnNow
				});
			}
		}

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

	if (
		newAssigneeId !== undefined &&
		newAssigneeId &&
		newAssigneeId !== existing.assigneeId &&
		newAssigneeId !== locals.user.id
	) {
		void createNotification({
			userId: newAssigneeId,
			type: 'assigned',
			body: `You were assigned to "${updated.title}"`,
			projectId: existing.projectId,
			taskId: existing.id
		});
	}

	broadcastProjectChange(existing.projectId, locals.user.id);
	const values = await customValuesByTask(existing.projectId, [params.id]);
	return json({ task: { ...updated, customFields: values[params.id] ?? {} } });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(task).where(eq(task.id, params.id));
	if (!existing) return apiError(404, 'Task not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, existing.projectId)))
		return apiError(404, 'Task not found');
	if (!(await canEditTask(locals.user, existing)))
		return apiError(403, 'No edit permission on this task');

	await db.delete(task).where(eq(task.parentId, params.id));
	await db.delete(task).where(eq(task.id, params.id));
	broadcastProjectChange(existing.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
