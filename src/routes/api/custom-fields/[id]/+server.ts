import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { customField } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { APPLIES_TO, parseConfig, validateFieldConfig } from '$lib/server/customFields';
import { deleteFilesForField } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

// Update a custom-field definition (name/appliesTo/config). TYPE is immutable.
// Mirrors the updateCustomField form action. Project derived from the field row.
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [f] = await db.select().from(customField).where(eq(customField.id, params.id));
	if (!f) return apiError(404, 'Custom field not found');
	// ADR-019: inaccessible field's project is indistinguishable from missing
	if (!(await canAccessProject(locals.user, f.projectId)))
		return apiError(404, 'Custom field not found');
	if (!(await canEditProject(locals.user, f.projectId)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	// type is type-encoded into stored values — never let it change
	if (body.type !== undefined && body.type !== f.type)
		return apiError(400, 'type is immutable after creation');

	const set: { name?: string; appliesTo?: string; config?: string } = {};

	if (body.name !== undefined) {
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return apiError(400, 'name is required');
		if (name.length > 60) return apiError(400, 'name too long (max 60)');
		const others = await db
			.select({ id: customField.id, name: customField.name })
			.from(customField)
			.where(eq(customField.projectId, f.projectId));
		if (others.some((o) => o.id !== f.id && o.name.toLowerCase() === name.toLowerCase()))
			return apiError(400, 'A field with that name already exists');
		set.name = name;
	}

	if (body.appliesTo !== undefined) {
		const appliesTo = typeof body.appliesTo === 'string' ? body.appliesTo : '';
		if (!APPLIES_TO.includes(appliesTo as (typeof APPLIES_TO)[number]))
			return apiError(400, 'Invalid appliesTo');
		set.appliesTo = appliesTo;
	}

	if (body.config !== undefined) {
		const configJson = typeof body.config === 'string' ? body.config : JSON.stringify(body.config);
		set.config = validateFieldConfig(f.type, configJson);
	}

	if (Object.keys(set).length === 0) return apiError(400, 'No fields to update');

	await db.update(customField).set(set).where(eq(customField.id, params.id));
	broadcastProjectChange(f.projectId, locals.user.id);
	const [updated] = await db.select().from(customField).where(eq(customField.id, params.id));
	return json({ customField: { ...updated, config: parseConfig(updated.config) } });
};

// Delete a custom-field definition. For files-type, unlink its bytes + rows first
// (FK only nulls file.fieldId otherwise). Mirrors the deleteCustomField form action.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [f] = await db
		.select({ id: customField.id, projectId: customField.projectId, type: customField.type })
		.from(customField)
		.where(eq(customField.id, params.id));
	if (!f) return apiError(404, 'Custom field not found');
	if (!(await canAccessProject(locals.user, f.projectId)))
		return apiError(404, 'Custom field not found');
	if (!(await canEditProject(locals.user, f.projectId)))
		return apiError(403, 'No edit permission on this project');

	if (f.type === 'files') await deleteFilesForField(f.id);
	await db.delete(customField).where(eq(customField.id, params.id));
	broadcastProjectChange(f.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
