import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { customField } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import {
	APPLIES_TO,
	isCustomFieldType,
	listProjectCustomFields,
	validateFieldConfig
} from '$lib/server/customFields';
import type { RequestHandler } from './$types';

// List custom-field DEFINITIONS for a project (config parsed, ordered for display).
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const customFields = await listProjectCustomFields(params.id);
	return json({ customFields });
};

// Create a custom-field definition. Mirrors the createCustomField form action.
export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	// ADR-019: don't confirm existence to users who can't edit — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'name is required');
	if (name.length > 60) return apiError(400, 'name too long (max 60)');

	const type = typeof body.type === 'string' ? body.type : '';
	if (!isCustomFieldType(type)) return apiError(400, 'Invalid field type');

	const appliesTo = typeof body.appliesTo === 'string' ? body.appliesTo : 'all';
	if (!APPLIES_TO.includes(appliesTo as (typeof APPLIES_TO)[number]))
		return apiError(400, 'Invalid appliesTo');

	const entity = body.entity === 'project' ? 'project' : 'task';

	// config may be a JSON object or a JSON string; validate/canonicalize for the type.
	const configJson =
		body.config === undefined || body.config === null
			? '{}'
			: typeof body.config === 'string'
				? body.config
				: JSON.stringify(body.config);

	// uniqueness is per-(project, entity) — task + project fields are separate value
	// tables, so a task field and a project field may share a name.
	const existing = await db
		.select({ name: customField.name, position: customField.position })
		.from(customField)
		.where(and(eq(customField.projectId, params.id), eq(customField.entity, entity)))
		.orderBy(asc(customField.position));
	if (existing.some((f) => f.name.toLowerCase() === name.toLowerCase()))
		return apiError(400, 'A field with that name already exists');

	const id = crypto.randomUUID();
	await db.insert(customField).values({
		id,
		projectId: params.id,
		entity,
		name,
		type,
		config: validateFieldConfig(type, configJson),
		appliesTo,
		position: (existing.at(-1)?.position ?? 0) + 10,
		createdAt: new Date()
	});

	broadcastProjectChange(params.id, locals.user.id);
	const [created] = await db.select().from(customField).where(eq(customField.id, id));
	return json({ customField: { ...created, config: JSON.parse(created.config) } }, { status: 201 });
};

// Reorder definitions: { order: [ids] } (full set, project-owned). Mirrors reorderCustomField.
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	if (!Array.isArray(body.order) || !body.order.every((x) => typeof x === 'string'))
		return apiError(400, 'order must be an array of field ids');
	const ids = (body.order as string[]).map((s) => s.trim()).filter(Boolean);

	const owned = await db
		.select({ id: customField.id })
		.from(customField)
		.where(eq(customField.projectId, params.id));
	const ownedIds = new Set(owned.map((f) => f.id));
	if (ids.length !== owned.length || !ids.every((i) => ownedIds.has(i)))
		return apiError(400, 'order must list every field of this project exactly once');

	for (let i = 0; i < ids.length; i++)
		await db.update(customField).set({ position: i * 10 }).where(eq(customField.id, ids[i]));

	broadcastProjectChange(params.id, locals.user.id);
	return json({ customFields: await listProjectCustomFields(params.id) });
};
