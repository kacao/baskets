import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { permission, user, workspace } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessWorkspace, listWorkspaceGrants } from '$lib/server/permissions';
import { getWorkspace } from '$lib/server/workspaces';
import { isOrgAdmin, orgRole } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

/** Join grant rows with the grantee's name; never leak anything sensitive. */
async function grantsView(workspaceId: string) {
	const rows = await listWorkspaceGrants(workspaceId);
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

/** Workspace grants are managed by org owners/admins OR the workspace owner (ADR-062). */
async function canManage(
	user: NonNullable<App.Locals['user']>,
	ws: typeof workspace.$inferSelect
): Promise<boolean> {
	if (ws.ownerId === user.id) return true;
	return ws.organizationId ? isOrgAdmin(user.id, ws.organizationId) : false;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const ws = await getWorkspace(params.id);
	if (!ws) return apiError(404, 'Workspace not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');
	if (!(await canManage(locals.user, ws)))
		return apiError(403, 'Only org admins or the owner can view workspace grants');

	return json({ grants: await grantsView(params.id) });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const ws = await getWorkspace(params.id);
	if (!ws) return apiError(404, 'Workspace not found');
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');
	if (!(await canManage(locals.user, ws)))
		return apiError(403, 'Only org admins or the owner can grant permissions');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const userId = typeof body.userId === 'string' ? body.userId : '';
	if (!userId) return apiError(400, 'Invalid grant');

	// grantee must be a member of the workspace's org (nonexistent vs out-of-org share
	// one error — no oracle). Grant org == resource org.
	if (!ws.organizationId || !(await orgRole(userId, ws.organizationId)))
		return apiError(400, 'Unknown user');

	await db
		.insert(permission)
		.values({
			id: crypto.randomUUID(),
			userId,
			resourceType: 'workspace',
			resourceId: params.id,
			organizationId: ws.organizationId,
			grantedBy: locals.user.id,
			createdAt: new Date()
		})
		.onConflictDoNothing();

	return json({ grants: await grantsView(params.id) }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, params, url, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const ws = await getWorkspace(params.id);
	if (!ws) return apiError(404, 'Workspace not found');
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');
	if (!(await canManage(locals.user, ws)))
		return apiError(403, 'Only org admins or the owner can revoke permissions');

	// revoke by grant id ({grantId} body or ?grantId=) or by user (?userId= / {userId})
	const body = await readJson(request);
	const grantId =
		(typeof body?.grantId === 'string' && body.grantId) || url.searchParams.get('grantId') || '';
	const userId =
		(typeof body?.userId === 'string' && body.userId) || url.searchParams.get('userId') || '';

	if (grantId) {
		await db
			.delete(permission)
			.where(
				and(
					eq(permission.id, grantId),
					eq(permission.resourceType, 'workspace'),
					eq(permission.resourceId, params.id)
				)
			);
	} else if (userId) {
		await db
			.delete(permission)
			.where(
				and(
					eq(permission.userId, userId),
					eq(permission.resourceType, 'workspace'),
					eq(permission.resourceId, params.id)
				)
			);
	} else {
		return apiError(400, 'Provide grantId or userId');
	}

	return new Response(null, { status: 204 });
};
