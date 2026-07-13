import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { permission, project, user, view } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { isAdmin, listProjectGrants } from '$lib/server/permissions';
import type { RequestHandler } from './$types';

/** Join grant rows with the grantee's name; never leak anything sensitive. */
async function grantsView(projectId: string) {
	const rows = await listProjectGrants(projectId);
	if (rows.length === 0) return [];
	const userIds = [...new Set(rows.map((r) => r.userId))];
	const users = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(inArray(user.id, userIds));
	const nameById = new Map(users.map((u) => [u.id, u.name]));
	return rows.map((r) => ({
		id: r.id,
		userId: r.userId,
		userName: nameById.get(r.userId) ?? null,
		resourceType: r.resourceType,
		resourceId: r.resourceId
	}));
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// project grants are admin-managed; gate BEFORE the lookup so non-admins can't probe existence
	if (!isAdmin(locals.user)) return apiError(403, 'Only admins can view project grants');
	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');

	return json({ grants: await grantsView(params.id) });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	if (!isAdmin(locals.user)) return apiError(403, 'Only admins can grant permissions');
	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const userId = typeof body.userId === 'string' ? body.userId : '';
	// default to a project grant; allow an optional view grant on a view of this project
	const resourceType = typeof body.resourceType === 'string' ? body.resourceType : 'project';
	const resourceId =
		body.resourceId === undefined || body.resourceId === null
			? params.id
			: typeof body.resourceId === 'string'
				? body.resourceId
				: '';

	if (!userId || !['project', 'view'].includes(resourceType) || !resourceId)
		return apiError(400, 'Invalid grant');
	if (resourceType === 'project' && resourceId !== params.id) return apiError(400, 'Invalid grant');
	if (resourceType === 'view') {
		const [v] = await db.select().from(view).where(eq(view.id, resourceId));
		if (!v || v.projectId !== params.id) return apiError(400, 'Invalid view');
	}

	const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
	if (!u) return apiError(400, 'Unknown user');

	await db
		.insert(permission)
		.values({
			id: crypto.randomUUID(),
			userId,
			resourceType,
			resourceId,
			grantedBy: locals.user.id,
			createdAt: new Date()
		})
		.onConflictDoNothing();

	return json({ grants: await grantsView(params.id) }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, params, url, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	if (!isAdmin(locals.user)) return apiError(403, 'Only admins can revoke permissions');
	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');

	// revoke by grant id ({grantId} body or ?grantId=) or by user (?userId= / {userId})
	const body = await readJson(request);
	const grantId =
		(typeof body?.grantId === 'string' && body.grantId) || url.searchParams.get('grantId') || '';
	const userId =
		(typeof body?.userId === 'string' && body.userId) || url.searchParams.get('userId') || '';

	if (grantId) {
		// only delete a grant that belongs to this project's grant set
		const owned = new Set((await listProjectGrants(params.id)).map((r) => r.id));
		if (!owned.has(grantId)) return apiError(404, 'Grant not found');
		await db.delete(permission).where(eq(permission.id, grantId));
	} else if (userId) {
		// revoke this user's direct grant on the project itself
		await db
			.delete(permission)
			.where(
				and(
					eq(permission.userId, userId),
					eq(permission.resourceType, 'project'),
					eq(permission.resourceId, params.id)
				)
			);
	} else {
		return apiError(400, 'Provide grantId or userId');
	}

	return new Response(null, { status: 204 });
};
