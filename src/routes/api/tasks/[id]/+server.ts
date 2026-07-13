import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import {
	apiError,
	readJson,
	optionalString,
	parseDateField,
	ApiValidationError,
	PRIORITIES
} from '$lib/server/api';
import { isValidRecurrence } from '$lib/recurrence';
import { canAccessProject, canEditTask } from '$lib/server/permissions';
import {
	apiCustomFieldEntries,
	customValuesByTask
} from '$lib/server/customFields';
import { deleteTaskService, updateTaskService, type UpdateTaskInput } from '$lib/server/tasks';
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

	const input: UpdateTaskInput = {};
	const has = new Set<keyof UpdateTaskInput>();

	if (body.title !== undefined) {
		const title = typeof body.title === 'string' ? body.title.trim() : '';
		if (!title) return apiError(400, 'title cannot be empty');
		if (title.length > 240) return apiError(400, 'title too long (max 240)');
		input.title = title;
		has.add('title');
	}

	if (body.statusId !== undefined) {
		input.statusId = typeof body.statusId === 'string' ? body.statusId : '';
		has.add('statusId');
	} else if (body.status !== undefined) {
		input.statusName = typeof body.status === 'string' ? body.status : '';
		has.add('statusName');
	}

	if (body.priority !== undefined) {
		if (!PRIORITIES.includes(body.priority as (typeof PRIORITIES)[number]))
			return apiError(400, `priority must be one of: ${PRIORITIES.join(', ')}`);
		input.priority = body.priority as string;
		has.add('priority');
	}

	if (body.description !== undefined) {
		try {
			input.description = optionalString(body.description, 'description');
		} catch (err) {
			if (err instanceof ApiValidationError) return apiError(400, err.message);
			throw err;
		}
		has.add('description');
	}

	if (body.assigneeId !== undefined) {
		input.assigneeId = typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null;
		has.add('assigneeId');
	}

	if (body.milestoneId !== undefined) {
		if (body.milestoneId === null || body.milestoneId === '') {
			input.milestoneId = null;
		} else if (typeof body.milestoneId === 'string') {
			input.milestoneId = body.milestoneId;
		} else {
			return apiError(400, 'milestoneId must be a string or null');
		}
		has.add('milestoneId');
	}

	if (body.locationId !== undefined) {
		if (body.locationId === null || body.locationId === '') {
			input.locationId = null;
		} else if (typeof body.locationId === 'string') {
			input.locationId = body.locationId;
		} else {
			return apiError(400, 'locationId must be a string or null');
		}
		has.add('locationId');
	}

	if (body.location !== undefined) {
		input.location =
			typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null;
		has.add('location');
	}

	if (body.order !== undefined) {
		if (body.order === null) {
			input.order = null;
		} else if (typeof body.order === 'number' && Number.isInteger(body.order)) {
			input.order = body.order;
		} else {
			return apiError(400, 'order must be an integer or null');
		}
		has.add('order');
	}

	if (body.dueDate !== undefined) {
		if (body.dueDate === null || body.dueDate === '') {
			input.dueDate = null;
		} else if (typeof body.dueDate === 'string') {
			try {
				input.dueDate = parseDateField(body.dueDate);
			} catch {
				return apiError(400, 'dueDate must be a valid date');
			}
		} else {
			return apiError(400, 'dueDate must be a string or null');
		}
		has.add('dueDate');
	}

	if (body.startDate !== undefined) {
		if (body.startDate === null || body.startDate === '') {
			input.startDate = null;
		} else if (typeof body.startDate === 'string') {
			try {
				input.startDate = parseDateField(body.startDate);
			} catch {
				return apiError(400, 'startDate must be a valid date');
			}
		} else {
			return apiError(400, 'startDate must be a string or null');
		}
		has.add('startDate');
	}

	if (body.recurrence !== undefined) {
		if (body.recurrence === null || body.recurrence === '') {
			input.recurrence = null;
		} else if (typeof body.recurrence === 'string') {
			const rule = body.recurrence.trim();
			if (!isValidRecurrence(rule)) return apiError(400, 'Invalid recurrence rule');
			input.recurrence = rule;
		} else {
			return apiError(400, 'recurrence must be a string or null');
		}
		has.add('recurrence');
	}

	// coverFileId: must reference an image file attached to THIS task (mirror setTaskCover)
	if (body.coverFileId !== undefined) {
		if (body.coverFileId === null || body.coverFileId === '') {
			input.coverFileId = null;
		} else if (typeof body.coverFileId === 'string') {
			input.coverFileId = body.coverFileId;
		} else {
			return apiError(400, 'coverFileId must be a string or null');
		}
		has.add('coverFileId');
	}

	// re-parent: move under another task, or null/"" to make it top-level. Depth-1 only.
	if (body.parentId !== undefined) {
		if (body.parentId === null || body.parentId === '') {
			input.parentId = null;
		} else if (typeof body.parentId === 'string') {
			input.parentId = body.parentId;
		} else {
			return apiError(400, 'parentId must be a string or null');
		}
		has.add('parentId');
	}

	const cfMap =
		body.customFields && typeof body.customFields === 'object' && !Array.isArray(body.customFields)
			? (body.customFields as Record<string, unknown>)
			: null;
	if (cfMap) input.cf = apiCustomFieldEntries(cfMap);

	if (has.size === 0 && !cfMap) return apiError(400, 'No fields to update');

	const res = await updateTaskService(params.id, existing.projectId, input, locals.user, {
		has: (key) => (key === 'cf' ? !!cfMap : has.has(key)),
		completeCascade: true,
		notifyAssignee: true
	});
	if (!res.ok) {
		// Preserve REST's distinct messages for the two known cases; otherwise pass through.
		if (res.message === 'Unknown assignee')
			return apiError(res.status, 'assigneeId must reference a valid user');
		return apiError(res.status, res.message);
	}

	const values = await customValuesByTask(existing.projectId, [params.id]);
	return json({ task: { ...res.data, customFields: values[params.id] ?? {} } });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(task).where(eq(task.id, params.id));
	if (!existing) return apiError(404, 'Task not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, existing.projectId)))
		return apiError(404, 'Task not found');

	const res = await deleteTaskService(params.id, existing.projectId, locals.user);
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
