import { redirect } from '@sveltejs/kit';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project, workspace } from '$lib/server/db/schema';
import { accessibleWorkspaceIds, grantedProjectIds } from '$lib/server/permissions';
import { resolveActiveOrgContext } from '$lib/server/orgs';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies, url }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	// Active org (ADR-062 D4): everything below is scoped to it.
	const { orgs, org, orgId, role } = await resolveActiveOrgContext(locals.user, cookies);
	if (!orgId) {
		// A signed-in user with 0 orgs must onboard first (D8). /onboarding lives
		// inside (app) and is exempt from this guard so the shell renders its
		// null-org state (no workspace/project sidebar).
		if (!url.pathname.startsWith('/onboarding')) {
			redirect(302, '/onboarding');
		}
		return {
			user: locals.user,
			orgs,
			currentOrg: org,
			orgRole: role,
			projects: [],
			workspaces: [],
			currentWorkspaceId: null
		};
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
			.innerJoin(workspace, eq(project.workspaceId, workspace.id))
			.where(eq(workspace.organizationId, orgId))
			.orderBy(desc(project.pinned), asc(project.name)),
		db
			.select({ id: workspace.id, name: workspace.name })
			.from(workspace)
			.where(eq(workspace.organizationId, orgId))
			.orderBy(asc(workspace.name)),
		accessibleWorkspaceIds(locals.user, orgId),
		grantedProjectIds(locals.user, orgId)
	]);

	// ADR-019: only accessible workspaces/projects are shown
	const projects = allProjects.filter(
		(p) => (p.workspaceId && wsAccess.has(p.workspaceId)) || projGrants.has(p.id)
	);
	const visibleWsIds = new Set(projects.map((p) => p.workspaceId));
	const workspaces = allWorkspaces.filter((w) => wsAccess.has(w.id) || visibleWsIds.has(w.id));

	const requested = cookies.get('workspace');
	const currentWorkspaceId =
		workspaces.find((w) => w.id === requested)?.id ?? workspaces[0]?.id ?? null;

	return {
		user: locals.user,
		orgs,
		currentOrg: org,
		orgRole: role,
		projects,
		workspaces,
		currentWorkspaceId
	};
};
