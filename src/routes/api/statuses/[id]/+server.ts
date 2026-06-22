import { json } from '@sveltejs/kit';
import { count, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, status, task } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { parseIconValue } from '$lib/server/icons';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject, canAccessWorkspace, canEditWorkspace, isAdmin } from '$lib/server/permissions';
import {
	listStatuses,
	listWorkspaceStatuses,
	listProjectCustomStatuses,
	STATUS_CATEGORIES,
	type StatusCategory
} from '$lib/server/statuses';
import type { RequestHandler } from './$types';

/** Accept a #rrggbb hex color, else null (JSON-body variant of the form parseColor). */
function parseColor(v: unknown): string | null {
	const s = String(v ?? '').trim();
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

/** Statuses a name collision is checked against, scoped to the edited status's owner. */
async function takenStatusNames(s: typeof status.$inferSelect) {
	if (s.projectId) {
		const [proj] = await db
			.select({ workspaceId: project.workspaceId })
			.from(project)
			.where(eq(project.id, s.projectId));
		const [defaults, wsStatuses, customs] = await Promise.all([
			listStatuses(),
			proj?.workspaceId ? listWorkspaceStatuses(proj.workspaceId) : Promise.resolve([]),
			listProjectCustomStatuses(s.projectId)
		]);
		return [...defaults, ...wsStatuses, ...customs];
	}
	// workspace-scoped: defaults + workspace siblings + statuses owned by its projects
	const projectIds = (
		await db.select({ id: project.id }).from(project).where(eq(project.workspaceId, s.workspaceId!))
	).map((p) => p.id);
	const projectStatuses =
		projectIds.length > 0
			? await db.select().from(status).where(inArray(status.projectId, projectIds))
			: [];
	return [...(await listStatuses()), ...(await listWorkspaceStatuses(s.workspaceId!)), ...projectStatuses];
}

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [s] = await db.select().from(status).where(eq(status.id, params.id));
	if (!s) return apiError(404, 'Status not found');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	// Built-in app-wide default (projectId + workspaceId both null): only the icon
	// is settable, admin-only (mirror setStatusIcon).
	if (!s.projectId && !s.workspaceId) {
		if (!isAdmin(locals.user)) return apiError(403, 'Admins only');
		const icon = parseIconValue(body.icon);
		if (!icon) return apiError(400, 'Pick an icon');
		const [updated] = await db.update(status).set({ icon }).where(eq(status.id, params.id)).returning();
		return json({ status: updated });
	}

	// Custom status: gate by its scope.
	if (s.projectId) {
		if (!(await canAccessProject(locals.user, s.projectId))) return apiError(404, 'Status not found');
		if (!(await canEditProject(locals.user, s.projectId)))
			return apiError(403, 'No edit permission on this project');
	} else {
		if (!(await canAccessWorkspace(locals.user, s.workspaceId!))) return apiError(404, 'Status not found');
		if (!(await canEditWorkspace(locals.user, s.workspaceId!)))
			return apiError(403, 'No edit permission on this workspace');
	}

	const updates: Partial<typeof status.$inferInsert> = {};

	if (body.name !== undefined) {
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return apiError(400, 'name cannot be empty');
		if (name.length > 40) return apiError(400, 'name too long (max 40)');
		const taken = await takenStatusNames(s);
		if (taken.some((x) => x.id !== s.id && x.name.toLowerCase() === name.toLowerCase()))
			return apiError(400, 'A status with that name already exists here');
		updates.name = name;
	}

	if (body.description !== undefined) {
		const description =
			typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
		if (description && description.length > 200) return apiError(400, 'description too long (max 200)');
		updates.description = description;
	}

	if (body.category !== undefined) {
		if (
			typeof body.category !== 'string' ||
			!STATUS_CATEGORIES.includes(body.category as StatusCategory)
		)
			return apiError(400, `category must be one of: ${STATUS_CATEGORIES.join(', ')}`);
		updates.category = body.category;
	}

	if (body.color !== undefined) updates.color = parseColor(body.color);
	if (body.icon !== undefined) updates.icon = parseIconValue(body.icon);

	if (Object.keys(updates).length === 0) return apiError(400, 'No fields to update');

	const [updated] = await db.update(status).set(updates).where(eq(status.id, params.id)).returning();
	if (s.projectId) broadcastProjectChange(s.projectId, locals.user.id);
	return json({ status: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [s] = await db.select().from(status).where(eq(status.id, params.id));
	if (!s) return apiError(404, 'Status not found');

	// Built-in defaults cannot be deleted.
	if (!s.projectId && !s.workspaceId) return apiError(400, 'Built-in statuses cannot be deleted');

	if (s.projectId) {
		if (!(await canAccessProject(locals.user, s.projectId))) return apiError(404, 'Status not found');
		if (!(await canEditProject(locals.user, s.projectId)))
			return apiError(403, 'No edit permission on this project');
	} else {
		if (!(await canAccessWorkspace(locals.user, s.workspaceId!))) return apiError(404, 'Status not found');
		if (!(await canEditWorkspace(locals.user, s.workspaceId!)))
			return apiError(403, 'No edit permission on this workspace');
	}

	const [{ n }] = await db
		.select({ n: count(task.id) })
		.from(task)
		.where(eq(task.statusId, params.id));
	if (n > 0) return apiError(400, `Status is used by ${n} task(s)`);

	await db.delete(status).where(eq(status.id, params.id));
	if (s.projectId) broadcastProjectChange(s.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
