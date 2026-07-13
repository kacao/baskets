import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, view } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessProject } from '$lib/server/permissions';
import { createView, duplicateView, reorderViews } from '$lib/server/views';
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

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	// Duplicate an existing view (copies type + config).
	if (body.duplicateViewId !== undefined) {
		if (typeof body.duplicateViewId !== 'string' || !body.duplicateViewId)
			return apiError(400, 'duplicateViewId must be a non-empty string');
		const res = await duplicateView(params.id, body.duplicateViewId, locals.user, {
			broadcast: true
		});
		if (!res.ok)
			return apiError(
				res.status,
				res.message === 'Invalid view'
					? 'duplicateViewId must reference a view of this project'
					: res.message
			);
		return json({ view: res.data }, { status: 201 });
	}

	// Create a new view of a given type (name auto-derived if not provided).
	const type = typeof body.type === 'string' ? body.type : '';
	if (!VIEW_TYPES.includes(type as ViewType))
		return apiError(400, `type must be one of: ${VIEW_TYPES.join(', ')}`);

	const res = await createView(
		params.id,
		{
			type,
			name: body.name !== undefined ? (typeof body.name === 'string' ? body.name : '') : undefined
		},
		locals.user,
		{ broadcast: true }
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ view: res.data }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	if (!Array.isArray(body.order) || body.order.length === 0)
		return apiError(400, 'order must be a non-empty array of view ids');
	const ids = body.order;
	if (!ids.every((id): id is string => typeof id === 'string' && !!id))
		return apiError(400, 'order must contain only view ids');

	const res = await reorderViews(params.id, ids as string[], locals.user, {
		broadcast: true,
		requireEditProject: true,
		invalidOrderMessage: 'order must reference only this project’s views'
	});
	if (!res.ok) return apiError(res.status, res.message);
	return json({ views: res.data });
};
