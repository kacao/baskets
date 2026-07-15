import { json } from '@sveltejs/kit';
import { apiError, readJson } from '$lib/server/api';
import {
	canAccessProject,
	canAccessWorkspace,
	canEditProject,
	canEditWorkspace
} from '$lib/server/permissions';
import {
	getTemplate,
	deleteTemplate,
	updateTemplatePayload,
	type TemplatePayload
} from '$lib/server/templates';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import type { RequestHandler } from './$types';

// REST surface for an individual task template (BASDEV-8).
// PATCH  -> overwrite a template's payload (and optionally name) in place.
// DELETE -> remove a template.
// Project-scoped templates need project-edit rights; workspace-scoped templates
// need workspace-edit rights (mirrors the saveTaskAsTemplate/deleteTemplate form
// actions). Inaccessible/missing templates are indistinguishable (404, ADR-019).

type Template = NonNullable<Awaited<ReturnType<typeof getTemplate>>>;

/** Shared guard: 404 for missing/inaccessible/orphaned, 403 for visible-but-not-editable. */
async function guardTemplateEdit(
	user: App.Locals['user'],
	id: string
): Promise<{ ok: false; error: Response } | { ok: true; tpl: Template }> {
	const tpl = await getTemplate(id);
	if (!tpl) return { ok: false, error: apiError(404, 'Template not found') };

	if (tpl.workspaceId) {
		// Workspace-scoped: 404 if no access, then 403 if no edit rights.
		if (!(await canAccessWorkspace(user, tpl.workspaceId)))
			return { ok: false, error: apiError(404, 'Template not found') };
		if (!(await canEditWorkspace(user, tpl.workspaceId)))
			return { ok: false, error: apiError(403, 'No edit permission on this template') };
	} else if (tpl.projectId) {
		// Project-scoped: 404 if no access, then 403 if no edit rights.
		if (!(await canAccessProject(user, tpl.projectId)))
			return { ok: false, error: apiError(404, 'Template not found') };
		if (!(await canEditProject(user, tpl.projectId)))
			return { ok: false, error: apiError(403, 'No edit permission on this template') };
	} else {
		// Orphaned template with neither scope — treat as not found.
		return { ok: false, error: apiError(404, 'Template not found') };
	}
	return { ok: true, tpl };
}

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const guarded = await guardTemplateEdit(locals.user, params.id);
	if (!guarded.ok) return guarded.error;
	const tpl = guarded.tpl;

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const payload = body.payload as TemplatePayload | undefined;
	if (!payload || typeof payload !== 'object' || !payload.task?.title)
		return apiError(400, 'payload.task.title is required');

	let name: string | undefined;
	if (body.name !== undefined) {
		name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return apiError(400, 'name cannot be empty');
		if (name.length > 120) return apiError(400, 'name too long (max 120)');
	}

	// Already authorized against the template's own scope — skip the project-relative check.
	const res = await updateTemplatePayload(params.id, null, payload, name);
	const updated = res ? await getTemplate(params.id) : null;
	// null = the row vanished between the guard and the write (concurrent DELETE)
	if (!updated) return apiError(404, 'Template not found');
	if (tpl.projectId) broadcastProjectChange(tpl.projectId, locals.user.id);
	return json({ template: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const guarded = await guardTemplateEdit(locals.user, params.id);
	if (!guarded.ok) return guarded.error;
	const tpl = guarded.tpl;

	await deleteTemplate(params.id);
	if (tpl.projectId) broadcastProjectChange(tpl.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
