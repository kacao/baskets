import { json } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { label } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import {
	canAccessProject,
	canAccessWorkspace,
	canEditProject,
	canEditWorkspace
} from '$lib/server/permissions';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { parseIconValue } from '$lib/server/icons';
import type { RequestHandler } from './$types';

// Validate a hex color string from a JSON body (mirror parseColor in settings).
function parseColor(v: unknown): string | null {
	const s = String(v ?? '').trim();
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

// A label is workspace-scoped (workspaceId) OR project-scoped (projectId).
// Gate accordingly: 404 if the caller can't access the owner, else 403 if
// they can't edit it. Returns null on success.
async function guardLabel(
	user: App.Locals['user'],
	row: typeof label.$inferSelect
): Promise<Response | null> {
	if (row.projectId) {
		if (!(await canAccessProject(user, row.projectId))) return apiError(404, 'Label not found');
		if (!(await canEditProject(user, row.projectId)))
			return apiError(403, 'No edit permission on this label');
	} else if (row.workspaceId) {
		if (!(await canAccessWorkspace(user, row.workspaceId))) return apiError(404, 'Label not found');
		if (!(await canEditWorkspace(user, row.workspaceId)))
			return apiError(403, 'No edit permission on this label');
	} else {
		return apiError(404, 'Label not found');
	}
	return null;
}

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(label).where(eq(label.id, params.id));
	if (!existing) return apiError(404, 'Label not found');
	const denied = await guardLabel(locals.user, existing);
	if (denied) return denied;

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const updates: Partial<typeof label.$inferInsert> = {};

	if (body.name !== undefined) {
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return apiError(400, 'Label name is required');
		if (name.length > 40) return apiError(400, 'Name too long (max 40)');
		// uniqueness is scoped to the label's owner (workspace OR project)
		const scope = existing.projectId
			? eq(label.projectId, existing.projectId)
			: eq(label.workspaceId, existing.workspaceId as string);
		const others = await db
			.select({ id: label.id, name: label.name })
			.from(label)
			.where(and(scope, ne(label.id, params.id)));
		if (others.some((l) => l.name.toLowerCase() === name.toLowerCase()))
			return apiError(400, 'A label with that name exists');
		updates.name = name;
	}

	if (body.color !== undefined) updates.color = parseColor(body.color);
	if (body.icon !== undefined) updates.icon = parseIconValue(body.icon);

	if (Object.keys(updates).length === 0) return apiError(400, 'No fields to update');

	const [updated] = await db
		.update(label)
		.set(updates)
		.where(eq(label.id, params.id))
		.returning();

	if (existing.projectId) broadcastProjectChange(existing.projectId, locals.user.id);
	return json({ label: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(label).where(eq(label.id, params.id));
	if (!existing) return apiError(404, 'Label not found');
	const denied = await guardLabel(locals.user, existing);
	if (denied) return denied;

	await db.delete(label).where(eq(label.id, params.id));
	if (existing.projectId) broadcastProjectChange(existing.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
