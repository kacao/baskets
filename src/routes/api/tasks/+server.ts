import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { location, milestone, project, task, user } from '$lib/server/db/schema';
import {
	apiError,
	readJson,
	optionalString,
	ApiValidationError,
	PRIORITIES
} from '$lib/server/api';
import { dispatchEvent } from '$lib/server/integrations';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject } from '$lib/server/permissions';
import { listProjectStatuses } from '$lib/server/statuses';
import {
	apiCustomFieldEntries,
	customValuesByTask,
	writeTaskCustomValues
} from '$lib/server/customFields';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const projectId = url.searchParams.get('projectId');
	if (!projectId) return apiError(400, 'projectId query parameter is required');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, projectId)))
		return apiError(404, 'Project not found');

	const tasks = await db
		.select()
		.from(task)
		.where(eq(task.projectId, projectId))
		.orderBy(asc(task.position), asc(task.createdAt));

	const values = await customValuesByTask(projectId, tasks.map((t) => t.id));
	return json({ tasks: tasks.map((t) => ({ ...t, customFields: values[t.id] ?? {} })) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const projectId = typeof body.projectId === 'string' ? body.projectId : '';
	const title = typeof body.title === 'string' ? body.title.trim() : '';
	const parentId = typeof body.parentId === 'string' ? body.parentId : null;
	const priority = typeof body.priority === 'string' ? body.priority : 'none';

	if (!projectId) return apiError(400, 'projectId is required');
	if (!title) return apiError(400, 'title is required');
	if (title.length > 240) return apiError(400, 'title too long (max 240)');
	if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number]))
		return apiError(400, `priority must be one of: ${PRIORITIES.join(', ')}`);

	const [proj] = await db.select().from(project).where(eq(project.id, projectId));
	if (!proj) return apiError(404, 'Project not found');
	if (!(await canAccessProject(locals.user, projectId)))
		return apiError(404, 'Project not found');

	if (parentId) {
		const [parent] = await db.select().from(task).where(eq(task.id, parentId));
		if (!parent || parent.projectId !== projectId) return apiError(400, 'Invalid parent task');
		if (parent.parentId) return apiError(400, 'Sub-tasks cannot have their own sub-tasks');
	}

	const eligible = await listProjectStatuses(projectId);

	// status: accepts statusId or status name; defaults to first todo-category status
	let statusId: string;
	const requested =
		typeof body.statusId === 'string'
			? eligible.find((s) => s.id === body.statusId)
			: typeof body.status === 'string'
				? eligible.find((s) => s.name.toLowerCase() === (body.status as string).toLowerCase())
				: undefined;
	if (body.statusId !== undefined || body.status !== undefined) {
		if (!requested)
			return apiError(400, `status must be one of: ${eligible.map((s) => s.name).join(', ')}`);
		statusId = requested.id;
	} else {
		const fallback = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
		if (!fallback) return apiError(400, 'Project has no eligible statuses');
		statusId = fallback.id;
	}

	if (body.milestoneId !== undefined && body.milestoneId !== null) {
		if (typeof body.milestoneId !== 'string') return apiError(400, 'milestoneId must be a string');
		const [m] = await db.select().from(milestone).where(eq(milestone.id, body.milestoneId));
		if (!m || m.projectId !== projectId)
			return apiError(400, 'milestoneId must reference a milestone of the same project');
	}

	if (body.locationId !== undefined && body.locationId !== null) {
		if (typeof body.locationId !== 'string') return apiError(400, 'locationId must be a string');
		const [l] = await db.select().from(location).where(eq(location.id, body.locationId));
		if (!l || l.projectId !== projectId)
			return apiError(400, 'locationId must reference a location of the same project');
	}

	if (body.assigneeId !== undefined && body.assigneeId !== null) {
		if (typeof body.assigneeId !== 'string') return apiError(400, 'assigneeId must be a string');
		const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, body.assigneeId));
		if (!u) return apiError(400, 'assigneeId must reference a valid user');
	}

	let description: string | null;
	try {
		description = optionalString(body.description, 'description');
	} catch (err) {
		if (err instanceof ApiValidationError) return apiError(400, err.message);
		throw err;
	}

	let dueDate: Date | null = null;
	if (typeof body.dueDate === 'string' && body.dueDate) {
		dueDate = new Date(body.dueDate.includes('T') ? body.dueDate : body.dueDate + 'T00:00:00');
		if (isNaN(dueDate.getTime())) return apiError(400, 'dueDate must be a valid date');
	}

	let order: number | null = null;
	if (body.order !== undefined && body.order !== null) {
		if (typeof body.order !== 'number' || !Number.isInteger(body.order))
			return apiError(400, 'order must be an integer or null');
		order = body.order;
	}

	const now = new Date();
	const [created] = await db
		.insert(task)
		.values({
			id: crypto.randomUUID(),
			projectId,
			parentId,
			title,
			description,
			priority,
			statusId,
			assigneeId: typeof body.assigneeId === 'string' ? body.assigneeId : null,
			milestoneId: typeof body.milestoneId === 'string' ? body.milestoneId : null,
			locationId: typeof body.locationId === 'string' ? body.locationId : null,
			location: typeof body.location === 'string' ? body.location.trim() || null : null,
			order,
			dueDate,
			createdBy: locals.user.id,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	if (body.customFields && typeof body.customFields === 'object' && !Array.isArray(body.customFields)) {
		const res = await writeTaskCustomValues(
			created.id,
			projectId,
			apiCustomFieldEntries(body.customFields as Record<string, unknown>)
		);
		if (res.error) {
			await db.delete(task).where(eq(task.id, created.id));
			return apiError(400, res.error);
		}
	}

	void dispatchEvent({
		type: 'task.created',
		actor: locals.user.name,
		projectName: proj.name,
		taskTitle: title
	});
	broadcastProjectChange(projectId, locals.user.id);

	const values = await customValuesByTask(projectId, [created.id]);
	return json({ task: { ...created, customFields: values[created.id] ?? {} } }, { status: 201 });
};
