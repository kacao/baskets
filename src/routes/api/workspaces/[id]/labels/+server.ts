import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { label, workspace } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessWorkspace, canEditWorkspace } from '$lib/server/permissions';
import { createLabel } from '$lib/server/labels';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [ws] = await db.select().from(workspace).where(eq(workspace.id, params.id));
	if (!ws) return apiError(404, 'Workspace not found');
	// ADR-019: inaccessible workspaces are indistinguishable from missing ones
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');

	const labels = await db
		.select()
		.from(label)
		.where(eq(label.workspaceId, params.id))
		.orderBy(asc(label.position), asc(label.name));
	return json({ labels });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [ws] = await db.select().from(workspace).where(eq(workspace.id, params.id));
	if (!ws) return apiError(404, 'Workspace not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessWorkspace(locals.user, params.id)))
		return apiError(404, 'Workspace not found');
	if (!(await canEditWorkspace(locals.user, params.id)))
		return apiError(403, 'No edit permission on this workspace');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const res = await createLabel(
		{ type: 'workspace', id: params.id },
		{
			name: typeof body.name === 'string' ? body.name : '',
			groupId: body.groupId as string | null | undefined,
			color: body.color,
			icon: body.icon
		},
		locals.user
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ label: res.data }, { status: 201 });
};
