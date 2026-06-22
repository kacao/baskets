import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { customField, customFieldOption, taskCustomValue } from '$lib/server/db/schema';
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

/** Resolve an option + its field/project, joining to its parent custom_field. */
async function loadOption(optionId: string) {
	const [row] = await db
		.select({
			id: customFieldOption.id,
			fieldId: customFieldOption.fieldId,
			projectId: customField.projectId
		})
		.from(customFieldOption)
		.innerJoin(customField, eq(customFieldOption.fieldId, customField.id))
		.where(eq(customFieldOption.id, optionId));
	return row ?? null;
}

// Update a select option (title/color/icon). Mirrors updateCustomFieldOption.
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const opt = await loadOption(params.id);
	if (!opt) return apiError(404, 'Option not found');
	// ADR-019: inaccessible option's project is indistinguishable from missing
	if (!(await canAccessProject(locals.user, opt.projectId)))
		return apiError(404, 'Option not found');
	if (!(await canEditProject(locals.user, opt.projectId)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const set: { title?: string; color?: string | null; icon?: string | null } = {};
	if (body.title !== undefined) {
		const title = typeof body.title === 'string' ? body.title.trim() : '';
		if (!title) return apiError(400, 'title is required');
		if (title.length > 60) return apiError(400, 'title too long (max 60)');
		set.title = title;
	}
	if (body.color !== undefined) set.color = parseColor(body.color);
	if (body.icon !== undefined) set.icon = parseIconValue(body.icon);

	if (Object.keys(set).length === 0) return apiError(400, 'No fields to update');

	await db.update(customFieldOption).set(set).where(eq(customFieldOption.id, params.id));
	broadcastProjectChange(opt.projectId, locals.user.id);
	const [updated] = await db
		.select()
		.from(customFieldOption)
		.where(eq(customFieldOption.id, params.id));
	return json({ option: updated });
};

// Delete a select option; strip its id from every value array of its field first
// (delete the row when it was the only value). Mirrors deleteCustomFieldOption.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const opt = await loadOption(params.id);
	if (!opt) return apiError(404, 'Option not found');
	if (!(await canAccessProject(locals.user, opt.projectId)))
		return apiError(404, 'Option not found');
	if (!(await canEditProject(locals.user, opt.projectId)))
		return apiError(403, 'No edit permission on this project');

	const rows = await db
		.select()
		.from(taskCustomValue)
		.where(eq(taskCustomValue.fieldId, opt.fieldId));
	for (const r of rows) {
		let ids: string[] = [];
		try {
			const v = JSON.parse(r.value);
			if (Array.isArray(v)) ids = v.map(String);
		} catch {
			continue;
		}
		if (!ids.includes(params.id)) continue;
		const next = ids.filter((x) => x !== params.id);
		if (next.length === 0)
			await db
				.delete(taskCustomValue)
				.where(and(eq(taskCustomValue.taskId, r.taskId), eq(taskCustomValue.fieldId, r.fieldId)));
		else
			await db
				.update(taskCustomValue)
				.set({ value: JSON.stringify(next) })
				.where(and(eq(taskCustomValue.taskId, r.taskId), eq(taskCustomValue.fieldId, r.fieldId)));
	}
	await db.delete(customFieldOption).where(eq(customFieldOption.id, params.id));
	broadcastProjectChange(opt.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
