import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { listSavedFilters, createSavedFilter } from '$lib/server/savedFilters';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const savedFilters = await listSavedFilters(params.id);
	return json({ savedFilters });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't edit — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'Filter name is required');
	if (name.length > 120) return apiError(400, 'Filter name too long (max 120)');

	const config = body.config;
	if (!config || typeof config !== 'object' || Array.isArray(config))
		return apiError(400, 'Invalid filter config');

	let saved;
	try {
		saved = await createSavedFilter({
			projectId: params.id,
			name,
			config: config as Record<string, unknown>,
			createdBy: locals.user.id
		});
	} catch (e) {
		return apiError(400, e instanceof Error ? e.message : 'Could not save filter');
	}

	broadcastProjectChange(params.id, locals.user.id);
	return json({ savedFilter: saved }, { status: 201 });
};
