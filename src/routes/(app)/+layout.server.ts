import { redirect } from '@sveltejs/kit';
import { asc, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, workspace } from '$lib/server/db/schema';
import { accessibleWorkspaceIds, grantedProjectIds } from '$lib/server/permissions';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const [allProjects, allWorkspaces, wsAccess, projGrants] = await Promise.all([
		db
			.select({
				id: project.id,
				name: project.name,
				icon: project.icon,
				workspaceId: project.workspaceId,
				pinned: project.pinned
			})
			.from(project)
			.orderBy(desc(project.pinned), asc(project.name)),
		db
			.select({ id: workspace.id, name: workspace.name })
			.from(workspace)
			.orderBy(asc(workspace.name)),
		accessibleWorkspaceIds(locals.user),
		grantedProjectIds(locals.user)
	]);

	// ADR-019: only accessible workspaces/projects are shown
	const projects =
		wsAccess === 'all'
			? allProjects
			: allProjects.filter(
					(p) => (p.workspaceId && wsAccess.has(p.workspaceId)) || projGrants.has(p.id)
				);
	const visibleWsIds = new Set(projects.map((p) => p.workspaceId));
	const workspaces =
		wsAccess === 'all'
			? allWorkspaces
			: allWorkspaces.filter((w) => wsAccess.has(w.id) || visibleWsIds.has(w.id));

	const requested = cookies.get('workspace');
	const currentWorkspaceId =
		workspaces.find((w) => w.id === requested)?.id ?? workspaces[0]?.id ?? null;

	return {
		user: locals.user,
		projects,
		workspaces,
		currentWorkspaceId
	};
};
