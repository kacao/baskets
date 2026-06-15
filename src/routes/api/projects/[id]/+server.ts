import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { customField, customFieldOption, location, milestone, project, task, view } from '$lib/server/db/schema';
import { apiError, readJson, optionalString, ApiValidationError } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { listProjectStatuses } from '$lib/server/statuses';
import { customValuesByTask, listCustomFieldOptions, listProjectCustomFields } from '$lib/server/customFields';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const [tasks, views, milestones, locations, statuses] = await Promise.all([
		db
			.select()
			.from(task)
			.where(eq(task.projectId, params.id))
			.orderBy(asc(task.position), asc(task.createdAt)),
		db
			.select()
			.from(view)
			.where(eq(view.projectId, params.id))
			.orderBy(asc(view.position), asc(view.createdAt)),
		db
			.select()
			.from(milestone)
			.where(eq(milestone.projectId, params.id))
			.orderBy(asc(milestone.position), asc(milestone.createdAt)),
		db
			.select()
			.from(location)
			.where(eq(location.projectId, params.id))
			.orderBy(asc(location.position), asc(location.title)),
		listProjectStatuses(params.id)
	]);

	const customFields = await listProjectCustomFields(params.id);
	const [customFieldOptions, valuesByTask] = await Promise.all([
		listCustomFieldOptions(customFields.map((f) => f.id)),
		customValuesByTask(params.id, tasks.map((t) => t.id))
	]);
	// attach each task's decoded custom-field value map
	const tasksWithCf = tasks.map((t) => ({ ...t, customFields: valuesByTask[t.id] ?? {} }));

	return json({
		project: proj,
		tasks: tasksWithCf,
		views,
		milestones,
		locations,
		statuses,
		customFields,
		customFieldOptions
	});
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const updates: Partial<typeof project.$inferInsert> = {};

	if (body.name !== undefined) {
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return apiError(400, 'name cannot be empty');
		if (name.length > 120) return apiError(400, 'name too long (max 120)');
		updates.name = name;
	}

	if (body.description !== undefined) {
		try {
			updates.description = optionalString(body.description, 'description');
		} catch (err) {
			if (err instanceof ApiValidationError) return apiError(400, err.message);
			throw err;
		}
	}

	if (Object.keys(updates).length === 0) return apiError(400, 'No fields to update');

	const [updated] = await db
		.update(project)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(project.id, params.id))
		.returning();

	broadcastProjectChange(params.id, locals.user.id);
	return json({ project: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	await db.delete(project).where(eq(project.id, params.id));
	broadcastProjectChange(params.id, locals.user.id);
	return new Response(null, { status: 204 });
};
