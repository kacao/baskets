import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import {
	apiCustomFieldEntries,
	listProjectCustomFields,
	listProjectCustomValues,
	writeProjectCustomValues
} from '$lib/server/customFields';
import { decodeValue } from '$lib/customFields';
import type { RequestHandler } from './$types';

// GET the project's own (entity='project') custom-field values, decoded.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	// A missing project must 404 for everyone (incl. admins) — mirror the siblings.
	const [proj] = await db.select({ id: project.id }).from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const fields = await listProjectCustomFields(params.id);
	const byId = new Map(fields.filter((f) => f.entity === 'project').map((f) => [f.id, f]));
	const rows = await listProjectCustomValues(params.id);
	const values: Record<string, unknown> = {};
	for (const r of rows) {
		const f = byId.get(r.fieldId);
		if (f) values[r.fieldId] = decodeValue(f, r.value);
	}
	return json({ values });
};

// Set the project's own (entity='project') custom-field values.
// Body: { customFields: { [fieldId]: value } }. Mirrors patchProjectCustomValues.
export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	const [proj] = await db.select({ id: project.id }).from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't edit — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const cfMap =
		body.customFields && typeof body.customFields === 'object' && !Array.isArray(body.customFields)
			? (body.customFields as Record<string, unknown>)
			: null;
	if (!cfMap) return apiError(400, 'customFields object is required');

	const entries = apiCustomFieldEntries(cfMap);
	if (entries.length) {
		const res = await writeProjectCustomValues(params.id, entries);
		if (res.error) return apiError(400, res.error);
	}

	broadcastProjectChange(params.id, locals.user.id);

	const fields = await listProjectCustomFields(params.id);
	const byId = new Map(fields.filter((f) => f.entity === 'project').map((f) => [f.id, f]));
	const rows = await listProjectCustomValues(params.id);
	const values: Record<string, unknown> = {};
	for (const r of rows) {
		const f = byId.get(r.fieldId);
		if (f) values[r.fieldId] = decodeValue(f, r.value);
	}
	return json({ values });
};
