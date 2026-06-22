import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import { apiError } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { getSavedFilter, deleteSavedFilter } from '$lib/server/savedFilters';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const filter = await getSavedFilter(params.id);
	if (!filter) return apiError(404, 'Saved filter not found');

	const [proj] = await db.select().from(project).where(eq(project.id, filter.projectId));
	if (!proj) return apiError(404, 'Saved filter not found');
	// ADR-019: don't confirm existence to users who can't access the project — 404, not 403
	if (!(await canAccessProject(locals.user, filter.projectId)))
		return apiError(404, 'Saved filter not found');
	if (!(await canEditProject(locals.user, filter.projectId)))
		return apiError(403, 'No edit permission on this project');

	const ok = await deleteSavedFilter(params.id, filter.projectId);
	if (!ok) return apiError(404, 'Saved filter not found');

	broadcastProjectChange(filter.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
