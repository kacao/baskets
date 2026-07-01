import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { label, project, projectLabel } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { createLabel, toggleProjectLabel } from '$lib/server/labels';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	// available labels = this project's workspace pool ∪ this project's own labels
	const [workspaceLabels, projectScopedLabels, attached] = await Promise.all([
		proj.workspaceId
			? db
					.select()
					.from(label)
					.where(eq(label.workspaceId, proj.workspaceId))
					.orderBy(asc(label.position), asc(label.name))
			: Promise.resolve([]),
		db
			.select()
			.from(label)
			.where(eq(label.projectId, params.id))
			.orderBy(asc(label.position), asc(label.name)),
		db.select().from(projectLabel).where(eq(projectLabel.projectId, params.id))
	]);

	const attachedIds = new Set(attached.map((r) => r.labelId));
	// project-scoped labels are always available; workspace labels only when attached
	const available = [...projectScopedLabels, ...workspaceLabels];
	return json({
		labels: available,
		workspaceLabels,
		projectLabels: projectScopedLabels,
		attachedLabelIds: [...attachedIds]
	});
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't access — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const res = await createLabel(
		{ type: 'project', id: params.id },
		{ name: typeof body.name === 'string' ? body.name : '', color: body.color, icon: body.icon },
		locals.user,
		{ broadcast: true }
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ label: res.data }, { status: 201 });
};

// Toggle a workspace label onto/off this project via project_label (port of
// toggleProjectLabel). Idempotent-ish: flips the membership.
async function toggle(request: Request, params: { id: string }, locals: App.Locals) {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	const labelId = typeof body.labelId === 'string' ? body.labelId : '';
	if (!labelId) return apiError(400, 'labelId is required');

	const res = await toggleProjectLabel(params.id, labelId, locals.user, { broadcast: true });
	if (!res.ok) return apiError(res.status, res.message);
	return json(res.data);
}

export const PUT: RequestHandler = ({ request, params, locals }) => toggle(request, params, locals);
export const PATCH: RequestHandler = ({ request, params, locals }) =>
	toggle(request, params, locals);
