import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { location, project } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import type { RequestHandler } from './$types';

/** Validate an optional coordinate: undefined/null/'' -> null; else a finite number in range. */
function parseCoord(
	value: unknown,
	field: string,
	min: number,
	max: number
): { value: number | null } | { error: string } {
	if (value === undefined || value === null || value === '') return { value: null };
	const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(num) || num < min || num > max)
		return { error: `${field} must be between ${min} and ${max}` };
	return { value: num };
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const locations = await db
		.select()
		.from(location)
		.where(eq(location.projectId, params.id))
		.orderBy(asc(location.position), asc(location.title));

	return json({ locations });
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

	const title = typeof body.title === 'string' ? body.title.trim() : '';
	if (!title) return apiError(400, 'title is required');
	if (title.length > 120) return apiError(400, 'title too long (max 120)');

	const address =
		typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null;
	if (address && address.length > 240) return apiError(400, 'address too long (max 240)');

	const lat = parseCoord(body.latitude, 'latitude', -90, 90);
	if ('error' in lat) return apiError(400, lat.error);
	const lng = parseCoord(body.longitude, 'longitude', -180, 180);
	if ('error' in lng) return apiError(400, lng.error);

	const now = new Date();
	const [created] = await db
		.insert(location)
		.values({
			id: crypto.randomUUID(),
			projectId: params.id,
			title,
			address,
			latitude: lat.value,
			longitude: lng.value,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	broadcastProjectChange(params.id, locals.user.id);
	return json({ location: created }, { status: 201 });
};
