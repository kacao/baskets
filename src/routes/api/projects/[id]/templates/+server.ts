import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { canAccessProject, canEditProject, canEditWorkspace } from '$lib/server/permissions';
import {
	createTemplate,
	instantiateTemplate,
	listTemplatesForProject,
	type TemplatePayload
} from '$lib/server/templates';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { readJson } from '$lib/server/api';
import type { RequestHandler } from './$types';

// REST surface for task templates scoped to a project (BASDEV-8).
// GET  -> list templates available to the project (own + workspace).
// POST { name, scope?, payload } -> create a template.
// POST { templateId, instantiate: true } -> create task(s) from a template.

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Not found');
	const templates = await listTemplatesForProject(params.id);
	return json({ templates });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Not found');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	// Instantiate path
	if (body.instantiate === true || typeof body.templateId === 'string') {
		const templateId = typeof body.templateId === 'string' ? body.templateId : '';
		if (!templateId) return apiError(400, 'templateId is required');
		let taskId: string | null;
		try {
			taskId = await instantiateTemplate(templateId, params.id, locals.user.id);
		} catch (err) {
			console.error('[templates] instantiate failed:', err);
			return apiError(400, 'Template could not be instantiated');
		}
		if (!taskId) return apiError(400, 'Template could not be instantiated');
		broadcastProjectChange(params.id, locals.user.id);
		return json({ taskId }, { status: 201 });
	}

	// Create path requires structure-edit rights (404 not 403 per access=visibility).
	if (!(await canEditProject(locals.user, params.id))) return apiError(404, 'Not found');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'name is required');
	if (name.length > 120) return apiError(400, 'name too long (max 120)');

	const payload = body.payload as TemplatePayload | undefined;
	if (!payload || typeof payload !== 'object' || !payload.task?.title)
		return apiError(400, 'payload.task.title is required');

	const scope = body.scope === 'workspace' ? 'workspace' : 'project';
	const [proj] = await db
		.select({ workspaceId: project.workspaceId })
		.from(project)
		.where(eq(project.id, params.id));

	// Workspace-scoped templates additionally need workspace-edit rights.
	if (scope === 'workspace') {
		if (!proj?.workspaceId) return apiError(404, 'Not found');
		if (!(await canEditWorkspace(locals.user, proj.workspaceId)))
			return apiError(404, 'Not found');
	}

	const id = await createTemplate({
		name,
		scope,
		projectId: params.id,
		workspaceId: proj?.workspaceId ?? null,
		payload,
		createdBy: locals.user.id
	});
	return json({ id }, { status: 201 });
};
