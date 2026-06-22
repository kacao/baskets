import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, view } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { VIEW_TYPES, type ViewType } from '$lib/server/projects';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const views = await db
		.select()
		.from(view)
		.where(eq(view.projectId, params.id))
		.orderBy(asc(view.position), asc(view.createdAt));

	return json({ views });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const now = new Date();
	const existing = await db
		.select({ name: view.name })
		.from(view)
		.where(eq(view.projectId, params.id));

	// Duplicate an existing view (copies type + config).
	if (body.duplicateViewId !== undefined) {
		if (typeof body.duplicateViewId !== 'string' || !body.duplicateViewId)
			return apiError(400, 'duplicateViewId must be a non-empty string');
		const [src] = await db.select().from(view).where(eq(view.id, body.duplicateViewId));
		if (!src || src.projectId !== params.id)
			return apiError(400, 'duplicateViewId must reference a view of this project');

		let name = `${src.name} copy`;
		for (let n = 2; existing.some((x) => x.name === name); n++) name = `${src.name} copy ${n}`;

		const newId = crypto.randomUUID();
		const [created] = await db
			.insert(view)
			.values({
				id: newId,
				projectId: params.id,
				name,
				type: src.type,
				config: src.config,
				position: src.position + 1,
				createdBy: locals.user.id,
				createdAt: now,
				updatedAt: now
			})
			.returning();

		broadcastProjectChange(params.id, locals.user.id);
		return json({ view: created }, { status: 201 });
	}

	// Create a new view of a given type (name auto-derived if not provided).
	const type = typeof body.type === 'string' ? body.type : '';
	if (!VIEW_TYPES.includes(type as ViewType))
		return apiError(400, `type must be one of: ${VIEW_TYPES.join(', ')}`);

	let name: string;
	if (body.name !== undefined) {
		name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return apiError(400, 'name cannot be empty');
		if (name.length > 120) return apiError(400, 'name too long (max 120)');
		if (existing.some((v) => v.name === name))
			return apiError(400, 'a view with that name already exists');
	} else {
		const base = type[0].toUpperCase() + type.slice(1);
		name = base;
		for (let n = 2; existing.some((v) => v.name === name); n++) name = `${base} ${n}`;
	}

	const id = crypto.randomUUID();
	const [created] = await db
		.insert(view)
		.values({
			id,
			projectId: params.id,
			name,
			type,
			config: '{}',
			position: now.getTime(),
			createdBy: locals.user.id,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	broadcastProjectChange(params.id, locals.user.id);
	return json({ view: created }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	if (!Array.isArray(body.order) || body.order.length === 0)
		return apiError(400, 'order must be a non-empty array of view ids');
	const ids = body.order;
	if (!ids.every((id): id is string => typeof id === 'string' && !!id))
		return apiError(400, 'order must contain only view ids');

	const rows = await db.select({ id: view.id }).from(view).where(eq(view.projectId, params.id));
	const projectIds = new Set(rows.map((r) => r.id));
	// the posted set must reference only this project's views
	if (!ids.every((id) => projectIds.has(id)))
		return apiError(400, 'order must reference only this project’s views');

	for (let i = 0; i < ids.length; i++)
		await db.update(view).set({ position: i * 10, updatedAt: new Date() }).where(eq(view.id, ids[i]));

	broadcastProjectChange(params.id, locals.user.id);
	const views = await db
		.select()
		.from(view)
		.where(eq(view.projectId, params.id))
		.orderBy(asc(view.position), asc(view.createdAt));
	return json({ views });
};
