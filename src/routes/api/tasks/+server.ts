import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { milestone, project, task } from '$lib/server/db/schema';
import {
	apiError,
	readJson,
	optionalString,
	parseDateField,
	ApiValidationError,
	PRIORITIES
} from '$lib/server/api';
import { canAccessProject } from '$lib/server/permissions';
import { apiCustomFieldEntries, customValuesByTask } from '$lib/server/customFields';
import { createTaskService } from '$lib/server/tasks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const projectId = url.searchParams.get('projectId');
	if (!projectId) return apiError(400, 'projectId query parameter is required');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, projectId))) return apiError(404, 'Project not found');

	const tasks = await db
		.select()
		.from(task)
		.where(eq(task.projectId, projectId))
		.orderBy(asc(task.position), asc(task.createdAt));

	const values = await customValuesByTask(
		projectId,
		tasks.map((t) => t.id)
	);
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

	// Existence 404 BEFORE access (ADR-019: identical to a no-access 404).
	const [proj] = await db.select().from(project).where(eq(project.id, projectId));
	if (!proj) return apiError(404, 'Project not found');
	if (!(await canAccessProject(locals.user, projectId))) return apiError(404, 'Project not found');

	// status: accepts statusId or status name; the service defaults + validates.
	const statusId = typeof body.statusId === 'string' ? body.statusId : undefined;
	const statusName =
		statusId === undefined && typeof body.status === 'string' ? body.status : undefined;

	if (body.milestoneId !== undefined && body.milestoneId !== null) {
		if (typeof body.milestoneId !== 'string') return apiError(400, 'milestoneId must be a string');
		const [m] = await db.select().from(milestone).where(eq(milestone.id, body.milestoneId));
		if (!m || m.projectId !== projectId)
			return apiError(400, 'milestoneId must reference a milestone of the same project');
	}

	if (body.locationId !== undefined && body.locationId !== null) {
		if (typeof body.locationId !== 'string') return apiError(400, 'locationId must be a string');
	}

	if (body.assigneeId !== undefined && body.assigneeId !== null) {
		if (typeof body.assigneeId !== 'string') return apiError(400, 'assigneeId must be a string');
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
		try {
			dueDate = parseDateField(body.dueDate);
		} catch {
			return apiError(400, 'dueDate must be a valid date');
		}
	}

	let order: number | null = null;
	if (body.order !== undefined && body.order !== null) {
		if (typeof body.order !== 'number' || !Number.isInteger(body.order))
			return apiError(400, 'order must be an integer or null');
		order = body.order;
	}

	const res = await createTaskService(
		{
			projectId,
			title,
			parentId,
			priority,
			statusId,
			statusName,
			assigneeId: typeof body.assigneeId === 'string' ? body.assigneeId : null,
			milestoneId: typeof body.milestoneId === 'string' ? body.milestoneId : null,
			locationId: typeof body.locationId === 'string' ? body.locationId : null,
			location: typeof body.location === 'string' ? body.location.trim() || null : null,
			description,
			order,
			dueDate,
			cf:
				body.customFields &&
				typeof body.customFields === 'object' &&
				!Array.isArray(body.customFields)
					? apiCustomFieldEntries(body.customFields as Record<string, unknown>)
					: undefined
		},
		locals.user
	);
	if (!res.ok) return apiError(res.status, res.message);

	const values = await customValuesByTask(projectId, [res.data.id]);
	return json({ task: { ...res.data, customFields: values[res.data.id] ?? {} } }, { status: 201 });
};
