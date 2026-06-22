import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { view } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditView } from '$lib/server/permissions';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [v] = await db.select().from(view).where(eq(view.id, params.id));
	if (!v) return apiError(404, 'View not found');
	// ADR-019: inaccessible views are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, v.projectId))) return apiError(404, 'View not found');
	if (!(await canEditView(locals.user, params.id)))
		return apiError(403, 'No edit permission on this view');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const updates: Partial<typeof view.$inferInsert> = {};

	if (body.name !== undefined) {
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return apiError(400, 'name cannot be empty');
		if (name.length > 120) return apiError(400, 'name too long (max 120)');
		updates.name = name;
	}

	// config is schemaless JSON — accept a string or an object, store as a string.
	if (body.config !== undefined) {
		let parsed: unknown;
		if (typeof body.config === 'string') {
			try {
				parsed = JSON.parse(body.config);
			} catch {
				return apiError(400, 'config must be valid JSON');
			}
		} else {
			parsed = body.config;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return apiError(400, 'config must be a JSON object');
		updates.config = JSON.stringify(parsed);
	}

	// hide / unhide. Hiding (or any state that would leave 0 visible) is rejected.
	if (body.hidden !== undefined) {
		if (typeof body.hidden !== 'boolean') return apiError(400, 'hidden must be a boolean');
		if (body.hidden && !v.hidden) {
			const visible = await db
				.select({ id: view.id })
				.from(view)
				.where(and(eq(view.projectId, v.projectId), eq(view.hidden, false)));
			if (visible.length <= 1)
				return apiError(400, 'A project must keep at least one visible view');
		}
		updates.hidden = body.hidden;
	}

	if (Object.keys(updates).length === 0) return apiError(400, 'No fields to update');

	const [updated] = await db
		.update(view)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(view.id, params.id))
		.returning();

	broadcastProjectChange(v.projectId, locals.user.id);
	return json({ view: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [v] = await db.select().from(view).where(eq(view.id, params.id));
	if (!v) return apiError(404, 'View not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, v.projectId))) return apiError(404, 'View not found');
	if (!(await canEditView(locals.user, params.id)))
		return apiError(403, 'No edit permission on this view');

	// A project must keep at least one visible view (a hidden view may be removed).
	const visible = await db
		.select({ id: view.id })
		.from(view)
		.where(and(eq(view.projectId, v.projectId), eq(view.hidden, false)));
	if (!v.hidden && visible.length <= 1)
		return apiError(400, 'A project must keep at least one view');

	await db.delete(view).where(eq(view.id, params.id));
	broadcastProjectChange(v.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
