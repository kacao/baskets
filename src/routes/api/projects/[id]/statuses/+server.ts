import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, projectStatus, status, task } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { parseIconValue } from '$lib/server/icons';
import {
	listProjectCustomStatuses,
	listProjectStatuses,
	listStatuses,
	listWorkspaceStatuses,
	STATUS_CATEGORIES,
	type StatusCategory
} from '$lib/server/statuses';
import type { RequestHandler } from './$types';

/** Defaults + the project's workspace statuses + its own statuses are assignable here. */
async function assignableStatuses(projectId: string) {
	const [proj] = await db
		.select({ workspaceId: project.workspaceId })
		.from(project)
		.where(eq(project.id, projectId));
	const [defaults, wsStatuses, customs] = await Promise.all([
		listStatuses(),
		proj?.workspaceId ? listWorkspaceStatuses(proj.workspaceId) : Promise.resolve([]),
		listProjectCustomStatuses(projectId)
	]);
	return [...defaults, ...wsStatuses, ...customs];
}

/** Accept a #rrggbb hex color, else null. */
function parseColor(v: unknown): string | null {
	const s = String(v ?? '').trim();
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

/** GET — the project's eligible (assignable-on-tasks) statuses, in global order. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const statuses = await listProjectStatuses(params.id);
	return json({ statuses });
};

/** POST — create a PROJECT-scoped status (mirrors the createStatus form action). */
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
	const description =
		typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
	const category = typeof body.category === 'string' ? body.category : 'backlog';

	if (!name) return apiError(400, 'Status name is required');
	if (name.length > 40) return apiError(400, 'Name too long (max 40)');
	if (description && description.length > 200)
		return apiError(400, 'Description too long (max 200)');
	if (!STATUS_CATEGORIES.includes(category as StatusCategory))
		return apiError(400, 'Invalid category');

	const color = parseColor(body.color);
	const icon = parseIconValue(body.icon);

	const taken = await assignableStatuses(params.id);
	if (taken.some((s) => s.name.toLowerCase() === name.toLowerCase()))
		return apiError(400, 'A status with that name already exists here');

	const id = crypto.randomUUID();
	const now = new Date();
	await db.insert(status).values({
		id,
		name,
		description,
		category,
		color,
		icon,
		projectId: params.id,
		position: (taken.at(-1)?.position ?? 0) + 10,
		builtIn: false,
		createdAt: now
	});
	// project statuses are eligible in their project by definition
	await db.insert(projectStatus).values({ projectId: params.id, statusId: id });

	broadcastProjectChange(params.id, locals.user.id);
	const [created] = await db.select().from(status).where(eq(status.id, id));
	return json({ status: created }, { status: 201 });
};

/**
 * PATCH — set the eligible status id set (statusIds) and/or reorder this project's
 * custom statuses (order). Mirrors the updateProjectStatuses + reorderStatus actions.
 */
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't edit — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const hasStatusIds = body.statusIds !== undefined;
	const hasOrder = body.order !== undefined;
	if (!hasStatusIds && !hasOrder)
		return apiError(400, 'Provide statusIds and/or order');

	// --- reorder this project's custom statuses (positions only; category unchanged) ---
	if (hasOrder) {
		if (!Array.isArray(body.order) || !body.order.every((v) => typeof v === 'string'))
			return apiError(400, 'order must be an array of status ids');
		const ids = (body.order as string[]).map((s) => s.trim()).filter(Boolean);

		const owned = await listProjectCustomStatuses(params.id);
		const ownedIds = new Set(owned.map((s) => s.id));
		if (ids.length !== owned.length || !ids.every((id) => ownedIds.has(id)))
			return apiError(400, 'Invalid order');

		const inherited = [
			...(await listStatuses()),
			...(proj.workspaceId ? await listWorkspaceStatuses(proj.workspaceId) : [])
		];
		// keep project customs sorted after defaults + workspace statuses globally
		const base = Math.max(0, ...inherited.map((s) => s.position)) + 10;
		for (let i = 0; i < ids.length; i++)
			await db.update(status).set({ position: base + i * 10 }).where(eq(status.id, ids[i]));
	}

	// --- set the eligible status id set ---
	if (hasStatusIds) {
		if (!Array.isArray(body.statusIds) || !body.statusIds.every((v) => typeof v === 'string'))
			return apiError(400, 'statusIds must be an array of status ids');
		const statusIds = (body.statusIds as string[]).map((s) => s.trim()).filter(Boolean);
		if (statusIds.length === 0)
			return apiError(400, 'A project needs at least one eligible status');

		const valid = new Set((await assignableStatuses(params.id)).map((s) => s.id));
		if (!statusIds.every((id) => valid.has(id))) return apiError(400, 'Unknown status');

		const inUse = await db
			.select({ statusId: task.statusId })
			.from(task)
			.where(eq(task.projectId, params.id));
		const keep = new Set(statusIds);
		if (inUse.some((t) => !keep.has(t.statusId)))
			return apiError(400, 'Cannot remove a status still used by tasks in this project');

		await db.delete(projectStatus).where(eq(projectStatus.projectId, params.id));
		await db
			.insert(projectStatus)
			.values(statusIds.map((statusId) => ({ projectId: params.id, statusId })));
	}

	broadcastProjectChange(params.id, locals.user.id);
	const statuses = await listProjectStatuses(params.id);
	return json({ statuses });
};
