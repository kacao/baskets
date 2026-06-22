import { json } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, workspace } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { accessibleWorkspaceIds, grantedProjectIds } from '$lib/server/permissions';
import { listWorkspaces } from '$lib/server/workspaces';
import { isFirstWorkspaceForUser, seedWorkspaceSamples } from '$lib/server/projects';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const all = await listWorkspaces();

	// ADR-019: list only accessible workspaces (incl. ones holding a granted project)
	const [wsAccess, projGrants] = await Promise.all([
		accessibleWorkspaceIds(locals.user),
		grantedProjectIds(locals.user)
	]);
	if (wsAccess === 'all') return json({ workspaces: all });

	const grantedWsIds = new Set(
		projGrants.size > 0
			? (
					await db
						.select({ workspaceId: project.workspaceId })
						.from(project)
						.where(inArray(project.id, [...projGrants]))
				).map((r) => r.workspaceId)
			: []
	);
	const workspaces = all.filter((w) => wsAccess.has(w.id) || grantedWsIds.has(w.id));
	return json({ workspaces });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'name is required');
	if (name.length > 120) return apiError(400, 'name too long (max 120)');

	const existing = await db.select({ name: workspace.name }).from(workspace);
	if (existing.some((w) => w.name.toLowerCase() === name.toLowerCase()))
		return apiError(400, 'A workspace with that name already exists');

	// the user's first workspace gets sample projects/milestones/tasks
	const seedSamples = await isFirstWorkspaceForUser(locals.user.id);

	const id = crypto.randomUUID();
	const now = new Date();
	await db.insert(workspace).values({
		id,
		name,
		ownerId: locals.user.id,
		createdAt: now,
		updatedAt: now
	});

	if (seedSamples) await seedWorkspaceSamples(id, locals.user);

	const [created] = await db.select().from(workspace).where(eq(workspace.id, id));
	return json({ workspace: created }, { status: 201 });
};
