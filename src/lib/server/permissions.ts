import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from './db';
import { permission, project, task, user, view, workspace } from './db/schema';

type SessionUser = { id: string; role?: string | null } | null | undefined;

export function isAdmin(user: SessionUser) {
	return user?.role === 'admin';
}

async function hasGrant(userId: string, pairs: { type: string; id: string }[]) {
	if (pairs.length === 0) return false;
	const rows = await db
		.select({ id: permission.id })
		.from(permission)
		.where(
			and(
				eq(permission.userId, userId),
				or(
					...pairs.map((p) =>
						and(eq(permission.resourceType, p.type), eq(permission.resourceId, p.id))
					)
				)
			)
		)
		.limit(1);
	return rows.length > 0;
}

/** Admins, the workspace owner, or users granted edit on the workspace. */
export async function canEditWorkspace(user: SessionUser, workspaceId: string) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	const [w] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
	if (!w) return false;
	if (w.ownerId === user.id) return true;
	return hasGrant(user.id, [{ type: 'workspace', id: workspaceId }]);
}

/** Admins, users granted edit on the project, or its workspace's owner/grantees. */
export async function canEditProject(user: SessionUser, projectId: string) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	const [p] = await db.select().from(project).where(eq(project.id, projectId));
	if (!p) return false;
	if (p.workspaceId) {
		const [w] = await db.select().from(workspace).where(eq(workspace.id, p.workspaceId));
		if (w?.ownerId === user.id) return true;
	}
	const pairs = [{ type: 'project', id: projectId }];
	if (p.workspaceId) pairs.push({ type: 'workspace', id: p.workspaceId });
	return hasGrant(user.id, pairs);
}

/** View grant, its project's grant, or its workspace (owner/grant). */
export async function canEditView(user: SessionUser, viewId: string) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	const [v] = await db.select().from(view).where(eq(view.id, viewId));
	if (!v) return false;
	if (await hasGrant(user.id, [{ type: 'view', id: viewId }])) return true;
	return canEditProject(user, v.projectId);
}

/**
 * Visibility (ADR-019): admins see everything; everyone else sees only
 * workspaces they own or hold a workspace grant on, plus projects they hold
 * a direct project grant on.
 */
export async function accessibleWorkspaceIds(user: SessionUser): Promise<'all' | Set<string>> {
	if (!user) return new Set();
	if (isAdmin(user)) return 'all';
	const [owned, granted] = await Promise.all([
		db.select({ id: workspace.id }).from(workspace).where(eq(workspace.ownerId, user.id)),
		db
			.select({ id: permission.resourceId })
			.from(permission)
			.where(and(eq(permission.userId, user.id), eq(permission.resourceType, 'workspace')))
	]);
	return new Set([...owned.map((r) => r.id), ...granted.map((r) => r.id)]);
}

/** Project ids the user holds direct project grants on. */
export async function grantedProjectIds(user: SessionUser): Promise<Set<string>> {
	if (!user) return new Set();
	const rows = await db
		.select({ id: permission.resourceId })
		.from(permission)
		.where(and(eq(permission.userId, user.id), eq(permission.resourceType, 'project')));
	return new Set(rows.map((r) => r.id));
}

export async function canAccessWorkspace(user: SessionUser, workspaceId: string) {
	const ids = await accessibleWorkspaceIds(user);
	return ids === 'all' || ids.has(workspaceId);
}

export async function canAccessProject(user: SessionUser, projectId: string) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	const [p] = await db.select().from(project).where(eq(project.id, projectId));
	if (!p) return false;
	if (p.workspaceId && (await canAccessWorkspace(user, p.workspaceId))) return true;
	return hasGrant(user.id, [{ type: 'project', id: projectId }]);
}

/**
 * Task editing (create/edit/move/status) is open to every member who can
 * ACCESS the project (ADR-019 narrows ADR-013's "any signed-in user").
 * Project/view STRUCTURE remains grant-gated via canEditProject/canEditView.
 */
export async function canEditTask(
	user: SessionUser,
	t: { id: string; parentId: string | null; projectId: string }
) {
	return canAccessProject(user, t.projectId);
}

/** Resource ids (project itself + its views + its tasks) the user holds grants on. */
export async function listProjectGrants(projectId: string) {
	const viewIds = (
		await db.select({ id: view.id }).from(view).where(eq(view.projectId, projectId))
	).map((r) => r.id);
	const taskIds = (
		await db.select({ id: task.id }).from(task).where(eq(task.projectId, projectId))
	).map((r) => r.id);

	const conds = [and(eq(permission.resourceType, 'project'), eq(permission.resourceId, projectId))];
	if (viewIds.length > 0)
		conds.push(and(eq(permission.resourceType, 'view'), inArray(permission.resourceId, viewIds)));
	if (taskIds.length > 0)
		conds.push(and(eq(permission.resourceType, 'task'), inArray(permission.resourceId, taskIds)));

	return db
		.select()
		.from(permission)
		.where(or(...conds));
}

/**
 * User ids that can ACCESS a project — admins, the workspace owner, workspace
 * grantees, and direct project grantees. This is the roster offerable as
 * assignees / shown in assignee groupings: ADR-019 says don't leak the full
 * user list (names + emails) to everyone who can see a single project.
 */
export async function projectAccessUserIds(
	projectId: string,
	workspaceId: string | null
): Promise<Set<string>> {
	const ids = new Set<string>();
	const admins = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin'));
	for (const a of admins) ids.add(a.id);

	const pairs: { type: string; id: string }[] = [{ type: 'project', id: projectId }];
	if (workspaceId) {
		const [w] = await db
			.select({ ownerId: workspace.ownerId })
			.from(workspace)
			.where(eq(workspace.id, workspaceId));
		if (w?.ownerId) ids.add(w.ownerId);
		pairs.push({ type: 'workspace', id: workspaceId });
	}
	const grants = await db
		.select({ uid: permission.userId })
		.from(permission)
		.where(
			or(
				...pairs.map((p) =>
					and(eq(permission.resourceType, p.type), eq(permission.resourceId, p.id))
				)
			)
		);
	for (const g of grants) ids.add(g.uid);
	return ids;
}

/** Grant rows on one workspace. */
export async function listWorkspaceGrants(workspaceId: string) {
	return db
		.select()
		.from(permission)
		.where(and(eq(permission.resourceType, 'workspace'), eq(permission.resourceId, workspaceId)));
}
