import { json } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, status } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { parseIconValue } from '$lib/server/icons';
import { canAccessWorkspace, canEditWorkspace } from '$lib/server/permissions';
import {
	listStatuses,
	listWorkspaceStatuses,
	STATUS_CATEGORIES,
	type StatusCategory
} from '$lib/server/statuses';
import type { RequestHandler } from './$types';

/** Accept a #rrggbb hex color, else null. */
function parseColor(v: unknown): string | null {
	const s = String(v ?? '').trim();
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

/** Names a new/renamed workspace status must not collide with: defaults,
 * workspace siblings, AND statuses owned by this workspace's projects. */
async function takenStatusNames(workspaceId: string) {
	const projectIds = (
		await db.select({ id: project.id }).from(project).where(eq(project.workspaceId, workspaceId))
	).map((p) => p.id);
	const projectStatuses =
		projectIds.length > 0
			? await db.select().from(status).where(inArray(status.projectId, projectIds))
			: [];
	return [
		...(await listStatuses()),
		...(await listWorkspaceStatuses(workspaceId)),
		...projectStatuses
	];
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	// ADR-019: inaccessible workspaces are indistinguishable from missing ones
	if (!(await canAccessWorkspace(locals.user, params.id))) return apiError(404, 'Workspace not found');

	const statuses = await listWorkspaceStatuses(params.id);
	return json({ statuses });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	if (!(await canAccessWorkspace(locals.user, params.id))) return apiError(404, 'Workspace not found');
	if (!(await canEditWorkspace(locals.user, params.id)))
		return apiError(403, 'No edit permission on this workspace');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'name is required');
	if (name.length > 40) return apiError(400, 'name too long (max 40)');

	const description =
		typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
	if (description && description.length > 200) return apiError(400, 'description too long (max 200)');

	const category = typeof body.category === 'string' ? body.category : 'backlog';
	if (!STATUS_CATEGORIES.includes(category as StatusCategory))
		return apiError(400, `category must be one of: ${STATUS_CATEGORIES.join(', ')}`);

	const color = parseColor(body.color);
	const icon = parseIconValue(body.icon);

	const taken = await takenStatusNames(params.id);
	if (taken.some((s) => s.name.toLowerCase() === name.toLowerCase()))
		return apiError(400, 'A status with that name already exists here');

	const [created] = await db
		.insert(status)
		.values({
			id: crypto.randomUUID(),
			name,
			description,
			category,
			color,
			icon,
			workspaceId: params.id,
			position: (taken.at(-1)?.position ?? 0) + 10,
			builtIn: false,
			createdAt: new Date()
		})
		.returning();

	return json({ status: created }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	if (!(await canAccessWorkspace(locals.user, params.id))) return apiError(404, 'Workspace not found');
	if (!(await canEditWorkspace(locals.user, params.id)))
		return apiError(403, 'No edit permission on this workspace');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	if (!Array.isArray(body.order) || !body.order.every((id) => typeof id === 'string'))
		return apiError(400, 'order must be an array of status ids');
	const ids = body.order as string[];

	const owned = await listWorkspaceStatuses(params.id);
	const ownedIds = new Set(owned.map((s) => s.id));
	if (ids.length !== owned.length || !ids.every((id) => ownedIds.has(id)))
		return apiError(400, 'order must list exactly this workspace’s statuses');

	// keep customs sorted after the built-in defaults globally
	const base = Math.max(0, ...(await listStatuses()).map((d) => d.position)) + 10;
	for (let i = 0; i < ids.length; i++)
		await db.update(status).set({ position: base + i * 10 }).where(eq(status.id, ids[i]));

	const statuses = await listWorkspaceStatuses(params.id);
	return json({ statuses });
};
