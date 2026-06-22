import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { labelGroup } from '$lib/server/db/schema';
import { apiError } from '$lib/server/api';
import { canAccessWorkspace, canEditWorkspace } from '$lib/server/permissions';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(labelGroup).where(eq(labelGroup.id, params.id));
	if (!existing) return apiError(404, 'Group not found');
	const wsId = existing.workspaceId;
	// ADR-019: groups belong to a workspace; gate on that workspace.
	if (!wsId || !(await canAccessWorkspace(locals.user, wsId)))
		return apiError(404, 'Group not found');
	if (!(await canEditWorkspace(locals.user, wsId)))
		return apiError(403, 'No edit permission on this workspace');

	// labels in the group survive (groupId set null via FK), mirroring deleteGroup.
	await db.delete(labelGroup).where(eq(labelGroup.id, params.id));
	return new Response(null, { status: 204 });
};
