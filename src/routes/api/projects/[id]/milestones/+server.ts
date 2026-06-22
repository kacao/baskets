import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { milestone, project } from '$lib/server/db/schema';
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

/** GET /api/projects/:id/milestones — milestones (position then createdAt). */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const milestones = await db
		.select()
		.from(milestone)
		.where(eq(milestone.projectId, params.id))
		.orderBy(asc(milestone.position), asc(milestone.createdAt));

	return json({ milestones });
};

/** POST /api/projects/:id/milestones — create a milestone (structure edit). */
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
	if (!name) return apiError(400, 'name is required');
	if (name.length > 120) return apiError(400, 'name too long (max 120)');

	let description: string | null;
	let startDate: Date | null;
	let targetDate: Date | null;
	try {
		description = optionalString(body.description, 'description');
		startDate = parseDate(body.startDate, 'startDate');
		targetDate = parseDate(body.targetDate, 'targetDate');
	} catch (err) {
		if (err instanceof ApiValidationError) return apiError(400, err.message);
		throw err;
	}

	const now = new Date();
	const [created] = await db
		.insert(milestone)
		.values({
			id: crypto.randomUUID(),
			projectId: params.id,
			name,
			description,
			startDate,
			targetDate,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	broadcastProjectChange(params.id, locals.user.id);
	return json({ milestone: created }, { status: 201 });
};
