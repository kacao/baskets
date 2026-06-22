import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { customField, customFieldOption } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { parseIconValue } from '$lib/server/icons';
import type { RequestHandler } from './$types';

/** Accept a #rrggbb hex color, else null. */
function parseColor(v: unknown): string | null {
	const s = String(v ?? '').trim();
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

// Create a select option { title, color?, icon? }. Mirrors createCustomFieldOption.
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [f] = await db.select().from(customField).where(eq(customField.id, params.id));
	if (!f) return apiError(404, 'Custom field not found');
	// ADR-019: inaccessible field's project is indistinguishable from missing
	if (!(await canAccessProject(locals.user, f.projectId)))
		return apiError(404, 'Custom field not found');
	if (!(await canEditProject(locals.user, f.projectId)))
		return apiError(403, 'No edit permission on this project');
	if (f.type !== 'select') return apiError(400, 'Not a select field');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const title = typeof body.title === 'string' ? body.title.trim() : '';
	if (!title) return apiError(400, 'title is required');
	if (title.length > 60) return apiError(400, 'title too long (max 60)');

	const opts = await db
		.select({ position: customFieldOption.position })
		.from(customFieldOption)
		.where(eq(customFieldOption.fieldId, params.id))
		.orderBy(asc(customFieldOption.position));

	const id = crypto.randomUUID();
	await db.insert(customFieldOption).values({
		id,
		fieldId: params.id,
		title,
		color: parseColor(body.color),
		icon: parseIconValue(body.icon),
		position: (opts.at(-1)?.position ?? 0) + 10,
		createdAt: new Date()
	});

	broadcastProjectChange(f.projectId, locals.user.id);
	const [created] = await db
		.select()
		.from(customFieldOption)
		.where(eq(customFieldOption.id, id));
	return json({ option: created }, { status: 201 });
};

// Reorder a field's options: { order: [ids] } (full set, field-owned).
// Mirrors reorderCustomFieldOption.
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [f] = await db
		.select({ id: customField.id, projectId: customField.projectId })
		.from(customField)
		.where(eq(customField.id, params.id));
	if (!f) return apiError(404, 'Custom field not found');
	if (!(await canAccessProject(locals.user, f.projectId)))
		return apiError(404, 'Custom field not found');
	if (!(await canEditProject(locals.user, f.projectId)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	if (!Array.isArray(body.order) || !body.order.every((x) => typeof x === 'string'))
		return apiError(400, 'order must be an array of option ids');
	const ids = (body.order as string[]).map((s) => s.trim()).filter(Boolean);

	const owned = await db
		.select({ id: customFieldOption.id })
		.from(customFieldOption)
		.where(eq(customFieldOption.fieldId, params.id));
	const ownedIds = new Set(owned.map((o) => o.id));
	if (ids.length !== owned.length || !ids.every((i) => ownedIds.has(i)))
		return apiError(400, 'order must list every option of this field exactly once');

	for (let i = 0; i < ids.length; i++)
		await db
			.update(customFieldOption)
			.set({ position: i * 10 })
			.where(eq(customFieldOption.id, ids[i]));

	broadcastProjectChange(f.projectId, locals.user.id);
	const options = await db
		.select()
		.from(customFieldOption)
		.where(eq(customFieldOption.fieldId, params.id))
		.orderBy(asc(customFieldOption.position), asc(customFieldOption.createdAt));
	return json({ options });
};
