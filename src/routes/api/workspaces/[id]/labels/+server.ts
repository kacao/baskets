import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { label, labelGroup, workspace } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessWorkspace, canEditWorkspace } from '$lib/server/permissions';
import { parseIconValue } from '$lib/server/icons';
import type { RequestHandler } from './$types';

// Validate a hex color string from a JSON body (mirror parseColor in settings).
function parseColor(v: unknown): string | null {
	const s = String(v ?? '').trim();
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

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

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'Label name is required');
	if (name.length > 40) return apiError(400, 'Name too long (max 40)');

	const existing = await db
		.select({ name: label.name })
		.from(label)
		.where(eq(label.workspaceId, params.id));
	if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase()))
		return apiError(400, 'A label with that name exists');

	let groupId: string | null = null;
	if (body.groupId !== undefined && body.groupId !== null && body.groupId !== '') {
		if (typeof body.groupId !== 'string') return apiError(400, 'groupId must be a string or null');
		const [g] = await db.select().from(labelGroup).where(eq(labelGroup.id, body.groupId));
		if (!g || g.workspaceId !== params.id) return apiError(400, 'Unknown group');
		groupId = body.groupId;
	}

	const [created] = await db
		.insert(label)
		.values({
			id: crypto.randomUUID(),
			name,
			workspaceId: params.id,
			groupId,
			color: parseColor(body.color),
			icon: parseIconValue(body.icon),
			position: Date.now(),
			createdAt: new Date()
		})
		.returning();
	return json({ label: created }, { status: 201 });
};
