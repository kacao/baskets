import { apiError } from '$lib/server/api';
import {
	canAccessProject,
	canAccessWorkspace,
	canEditProject,
	canEditWorkspace
} from '$lib/server/permissions';
import { getTemplate, deleteTemplate } from '$lib/server/templates';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import type { RequestHandler } from './$types';

// REST surface for an individual task template (BASDEV-8).
// DELETE -> remove a template. Project-scoped templates need project-edit rights;
// workspace-scoped templates need workspace-edit rights (mirrors the deleteTemplate
// form action). Inaccessible/missing templates are indistinguishable (404, ADR-019).

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const tpl = await getTemplate(params.id);
	if (!tpl) return apiError(404, 'Template not found');

	if (tpl.workspaceId) {
		// Workspace-scoped: 404 if no access, then 403 if no edit rights.
		if (!(await canAccessWorkspace(locals.user, tpl.workspaceId)))
			return apiError(404, 'Template not found');
		if (!(await canEditWorkspace(locals.user, tpl.workspaceId)))
			return apiError(403, 'No edit permission on this template');
	} else if (tpl.projectId) {
		// Project-scoped: 404 if no access, then 403 if no edit rights.
		if (!(await canAccessProject(locals.user, tpl.projectId)))
			return apiError(404, 'Template not found');
		if (!(await canEditProject(locals.user, tpl.projectId)))
			return apiError(403, 'No edit permission on this template');
	} else {
		// Orphaned template with neither scope — treat as not found.
		return apiError(404, 'Template not found');
	}

	await deleteTemplate(params.id);
	if (tpl.projectId) broadcastProjectChange(tpl.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
