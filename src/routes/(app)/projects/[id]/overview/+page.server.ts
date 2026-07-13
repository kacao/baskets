// Project "Overview" page — a focused editor for the project title + description.
// Reuses the settings `updateProject` action (name required → 400 if blank; reads
// description/startDate/dueDate; gated on canEditProject). The load is INDEPENDENT
// of the heavy settings load: it returns only the project + the candidate "bags"
// the description editor/renderer need to resolve @-references, access-scoped per
// ADR-019 (inaccessible ≡ missing → 404; rosters/project lists are visibility-filtered).
import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { file, project, task, location } from '$lib/server/db/schema';
import {
	accessibleWorkspaceIds,
	canAccessProject,
	canEditProject,
	grantedProjectIds,
	projectAccessUserIds,
	workspaceOrgId
} from '$lib/server/permissions';
import { isOrgAdmin, listMembers } from '$lib/server/orgs';
import type { PageServerLoad } from './$types';

export { actions } from '../settings/+page.server';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not signed in');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) error(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) error(404, 'Project not found');

	const projOrgId = proj.workspaceId ? await workspaceOrgId(proj.workspaceId) : null;

	const [tasks, locations, files, allProjects, members] = await Promise.all([
		db
			.select({ id: task.id, title: task.title })
			.from(task)
			.where(eq(task.projectId, params.id))
			.orderBy(asc(task.position), asc(task.createdAt)),
		db
			.select({ id: location.id, title: location.title, address: location.address })
			.from(location)
			.where(eq(location.projectId, params.id))
			.orderBy(asc(location.position), asc(location.title)),
		// NEVER expose file.storagePath
		db
			.select({ id: file.id, filename: file.filename, mimeType: file.mimeType })
			.from(file)
			.where(eq(file.projectId, params.id)),
		db
			.select({ id: project.id, name: project.name, workspaceId: project.workspaceId })
			.from(project)
			.orderBy(asc(project.name)),
		// roster = org members only (ADR-062), not the full user table
		projOrgId ? listMembers(projOrgId) : Promise.resolve([])
	]);
	const users = members.map((m) => ({ id: m.userId, name: m.name, email: m.email }));

	// ADR-019/ADR-062: the @-project picker offers only accessible projects in this org.
	const [wsAccess, projGrants] = await Promise.all([
		accessibleWorkspaceIds(locals.user, projOrgId),
		grantedProjectIds(locals.user, projOrgId)
	]);
	const visibleProjects = allProjects.filter(
		(p) => (p.workspaceId && wsAccess.has(p.workspaceId)) || projGrants.has(p.id)
	);

	// ADR-019: people roster is access-scoped — org admins get the org roster; everyone
	// else sees users who can access THIS project ∪ those already referenced as task
	// assignees (so existing values still resolve to a name). Don't leak the org.
	const admin = projOrgId ? await isOrgAdmin(locals.user.id, projOrgId) : false;
	let visibleUsers = users;
	if (!admin) {
		const ids = await projectAccessUserIds(params.id, proj.workspaceId);
		const assigneeIds = (
			await db
				.select({ assigneeId: task.assigneeId })
				.from(task)
				.where(eq(task.projectId, params.id))
		).map((r) => r.assigneeId);
		for (const id of assigneeIds) if (id) ids.add(id);
		visibleUsers = users.filter((u) => ids.has(u.id));
	}

	return {
		project: {
			id: proj.id,
			name: proj.name,
			description: proj.description,
			icon: proj.icon,
			startDate: proj.startDate,
			dueDate: proj.dueDate,
			workspaceId: proj.workspaceId,
			createdAt: proj.createdAt,
			updatedAt: proj.updatedAt
		},
		perm: { canEdit: await canEditProject(locals.user, params.id) },
		tasks,
		locations,
		files,
		projects: visibleProjects.map((p) => ({ id: p.id, name: p.name })),
		people: visibleUsers.map((u) => ({ id: u.id, name: u.name, email: u.email }))
	};
};
