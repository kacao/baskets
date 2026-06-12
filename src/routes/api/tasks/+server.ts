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
import { canEditProject, canEditTask } from '$lib/server/permissions';
import { listProjectStatuses } from '$lib/server/statuses';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const projectId = url.searchParams.get('projectId');
	if (!projectId) return apiError(400, 'projectId query parameter is required');

	const tasks = await db
		.select()
		.from(task)
		.where(eq(task.projectId, projectId))
		.orderBy(asc(task.position), asc(task.createdAt));

	return json({ tasks });
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

	let allowed = await canEditProject(locals.user, projectId);

	let parent = null;
	if (parentId) {
		[parent] = await db.select().from(task).where(eq(task.id, parentId));
		if (!parent || parent.projectId !== projectId) return apiError(400, 'Invalid parent task');
		if (parent.parentId) return apiError(400, 'Sub-tasks cannot have their own sub-tasks');
		if (!allowed) allowed = await canEditTask(locals.user, parent);
	}
	if (!allowed) return apiError(403, 'No edit permission on this project');

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
		const fallback = eligible.find((s) => s.category === 'todo') ?? eligible[0];
		if (!fallback) return apiError(400, 'Project has no eligible statuses');
		statusId = fallback.id;
	}

	if (body.milestoneId !== undefined && body.milestoneId !== null) {
		if (typeof body.milestoneId !== 'string') return apiError(400, 'milestoneId must be a string');
		const [m] = await db.select().from(milestone).where(eq(milestone.id, body.milestoneId));
		if (!m || m.projectId !== projectId)
			return apiError(400, 'milestoneId must reference a milestone of the same project');
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
			milestoneId: typeof body.milestoneId === 'string' ? body.milestoneId : null,
			location: typeof body.location === 'string' ? body.location.trim() || null : null,
			dueDate,
			createdBy: locals.user.id,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	void dispatchEvent({
		type: 'task.created',
		actor: locals.user.name,
		projectName: proj.name,
		taskTitle: title
	});

	return json({ task: created }, { status: 201 });
};
