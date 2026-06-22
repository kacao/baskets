import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { location } from '$lib/server/db/schema';
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

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [loc] = await db.select().from(location).where(eq(location.id, params.id));
	if (!loc) return apiError(404, 'Location not found');
	// ADR-019: inaccessible projects' locations are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, loc.projectId)))
		return apiError(404, 'Location not found');
	if (!(await canEditProject(locals.user, loc.projectId)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const updates: Partial<typeof location.$inferInsert> = {};

	if (body.title !== undefined) {
		const title = typeof body.title === 'string' ? body.title.trim() : '';
		if (!title) return apiError(400, 'title cannot be empty');
		if (title.length > 120) return apiError(400, 'title too long (max 120)');
		updates.title = title;
	}

	if (body.address !== undefined) {
		const address =
			typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null;
		if (address && address.length > 240) return apiError(400, 'address too long (max 240)');
		updates.address = address;
	}

	if (body.latitude !== undefined) {
		const lat = parseCoord(body.latitude, 'latitude', -90, 90);
		if ('error' in lat) return apiError(400, lat.error);
		updates.latitude = lat.value;
	}

	if (body.longitude !== undefined) {
		const lng = parseCoord(body.longitude, 'longitude', -180, 180);
		if ('error' in lng) return apiError(400, lng.error);
		updates.longitude = lng.value;
	}

	if (Object.keys(updates).length === 0) return apiError(400, 'No fields to update');

	const [updated] = await db
		.update(location)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(location.id, params.id))
		.returning();

	broadcastProjectChange(loc.projectId, locals.user.id);
	return json({ location: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [loc] = await db.select().from(location).where(eq(location.id, params.id));
	if (!loc) return apiError(404, 'Location not found');
	// ADR-019: don't confirm existence to users who can't edit — 404, not 403
	if (!(await canAccessProject(locals.user, loc.projectId)))
		return apiError(404, 'Location not found');
	if (!(await canEditProject(locals.user, loc.projectId)))
		return apiError(403, 'No edit permission on this project');

	// task.locationId FK is `set null` on delete — tasks keep their row, lose the ref.
	await db.delete(location).where(eq(location.id, params.id));
	broadcastProjectChange(loc.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
