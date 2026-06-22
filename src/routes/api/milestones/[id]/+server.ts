import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { milestone } from '$lib/server/db/schema';
import { apiError, readJson, optionalString, ApiValidationError } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import type { RequestHandler } from './$types';

/** Parses an optional YYYY-MM-DD (or ISO) date field. Returns Date | null, or throws on bad input. */
function parseDate(value: unknown, field: string): Date | null {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string') throw new ApiValidationError(`${field} must be a string or null`);
	const d = new Date(value.includes('T') ? value : value + 'T00:00:00');
	if (isNaN(d.getTime())) throw new ApiValidationError(`${field} must be a valid date`);
	return d;
}

/** PATCH /api/milestones/:id — update name/description/startDate/targetDate (structure edit). */
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [ms] = await db.select().from(milestone).where(eq(milestone.id, params.id));
	if (!ms) return apiError(404, 'Milestone not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, ms.projectId)))
		return apiError(404, 'Milestone not found');
	if (!(await canEditProject(locals.user, ms.projectId)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const updates: Partial<typeof milestone.$inferInsert> = {};

	if (body.name !== undefined) {
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return apiError(400, 'name cannot be empty');
		if (name.length > 120) return apiError(400, 'name too long (max 120)');
		updates.name = name;
	}

	try {
		if (body.description !== undefined)
			updates.description = optionalString(body.description, 'description');
		if (body.startDate !== undefined) updates.startDate = parseDate(body.startDate, 'startDate');
		if (body.targetDate !== undefined) updates.targetDate = parseDate(body.targetDate, 'targetDate');
	} catch (err) {
		if (err instanceof ApiValidationError) return apiError(400, err.message);
		throw err;
	}

	if (Object.keys(updates).length === 0) return apiError(400, 'No fields to update');

	const [updated] = await db
		.update(milestone)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(milestone.id, params.id))
		.returning();

	broadcastProjectChange(ms.projectId, locals.user.id);
	return json({ milestone: updated });
};

/** DELETE /api/milestones/:id — delete a milestone (structure edit). */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [ms] = await db.select().from(milestone).where(eq(milestone.id, params.id));
	if (!ms) return apiError(404, 'Milestone not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, ms.projectId)))
		return apiError(404, 'Milestone not found');
	if (!(await canEditProject(locals.user, ms.projectId)))
		return apiError(403, 'No edit permission on this project');

	await db.delete(milestone).where(eq(milestone.id, params.id));
	broadcastProjectChange(ms.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
