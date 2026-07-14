import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from './db';
import { member, permission, project, task, user, view, workspace } from './db/schema';

type SessionUser = { id: string; role?: string | null } | null | undefined;

/**
 * Instance operator (admin plugin — `user.role === 'admin'`). This is an
 * INSTANCE-level role for managing the deployment; it is NOT a tenant role and
 * NEVER short-circuits org data guards (ADR-062 D3). Tenant powers live only on
 * `member.role` (owner/admin/member); use `isOrgAdmin`/`orgRole` from `./orgs`
 * for those. The only surfaces this gate keeps are /admin + /settings/statuses.
 */
export function isInstanceAdmin(user: SessionUser) {
	return user?.role === 'admin';
}

type OrgRole = 'owner' | 'admin' | 'member';

/**
 * The user's role in an org, or null when they are NOT a member. Membership is a
 * prerequisite for any access to that org's data (ADR-062 D3) — a null role means
 * every guard below returns false, so stale grants go inert once a user leaves or
 * is removed. (Kept private to permissions.ts to avoid an import cycle through
 * orgs → projects → statuses → permissions; `orgRole` in orgs.ts is the public twin.)
 */
async function memberRole(userId: string, orgId: string): Promise<OrgRole | null> {
	const [m] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
		.limit(1);
	return (m?.role as OrgRole | undefined) ?? null;
}

const isOrgAdminRole = (r: OrgRole | null) => r === 'owner' || r === 'admin';

/** The organization a workspace belongs to (null = integrity error: an org-less workspace). */
export async function workspaceOrgId(workspaceId: string): Promise<string | null> {
	const [w] = await db
		.select({ orgId: workspace.organizationId })
		.from(workspace)
		.where(eq(workspace.id, workspaceId));
	return w?.orgId ?? null;
}

/** The organization a project belongs to (resolved via its workspace); null if unresolvable. */
export async function projectOrgId(projectId: string): Promise<string | null> {
	const [row] = await db
		.select({ orgId: workspace.organizationId })
		.from(project)
		.leftJoin(workspace, eq(project.workspaceId, workspace.id))
		.where(eq(project.id, projectId));
	return row?.orgId ?? null;
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

async function workspaceMeta(
	workspaceId: string
): Promise<{ orgId: string | null; ownerId: string } | null> {
	const [w] = await db
		.select({ orgId: workspace.organizationId, ownerId: workspace.ownerId })
		.from(workspace)
		.where(eq(workspace.id, workspaceId));
	return w ?? null;
}

/**
 * Shared workspace guard: org owner/admin ∨ workspace owner ∨ workspace grant,
 * gated behind org membership (ADR-062 D3). For a workspace, ACCESS and EDIT
 * resolve to the same set (there is one grant type per workspace), so
 * canAccessWorkspace and canEditWorkspace both delegate here.
 */
async function grantsWorkspace(user: SessionUser, workspaceId: string): Promise<boolean> {
	if (!user) return false;
	const w = await workspaceMeta(workspaceId);
	if (!w) return false;
	if (!w.orgId) {
		console.error('[permissions] integrity: workspace %s has no organizationId', workspaceId);
		return false;
	}
	const role = await memberRole(user.id, w.orgId);
	if (!role) return false; // membership prerequisite
	if (isOrgAdminRole(role)) return true;
	if (w.ownerId === user.id) return true;
	return hasGrant(user.id, [{ type: 'workspace', id: workspaceId }]);
}

/** Org owner/admin, the workspace owner, or a workspace grantee — after org membership. */
export function canEditWorkspace(user: SessionUser, workspaceId: string): Promise<boolean> {
	return grantsWorkspace(user, workspaceId);
}

/** Visibility of a workspace (ADR-019). Same set as edit; membership-gated. */
export function canAccessWorkspace(user: SessionUser, workspaceId: string): Promise<boolean> {
	return grantsWorkspace(user, workspaceId);
}

type ProjectContext = { orgId: string; wsOwnerId: string; workspaceId: string };

/** Resolve a project's org + workspace owner in one query; null when unresolvable (missing/orphan). */
async function projectContext(projectId: string): Promise<ProjectContext | null> {
	const [row] = await db
		.select({
			workspaceId: project.workspaceId,
			orgId: workspace.organizationId,
			wsOwnerId: workspace.ownerId
		})
		.from(project)
		.leftJoin(workspace, eq(project.workspaceId, workspace.id))
		.where(eq(project.id, projectId));
	if (!row) return null;
	if (!row.workspaceId) {
		console.error('[permissions] integrity: project %s has no workspaceId', projectId);
		return null;
	}
	if (!row.orgId || !row.wsOwnerId) {
		console.error('[permissions] integrity: project %s workspace has no organizationId', projectId);
		return null;
	}
	return { orgId: row.orgId, wsOwnerId: row.wsOwnerId, workspaceId: row.workspaceId };
}

/**
 * Shared project guard: org owner/admin ∨ workspace owner ∨ project/workspace
 * grant, gated behind org membership. Like workspaces, project ACCESS and EDIT
 * resolve to the same set (structure edit vs task edit is a separate, wider
 * contract — see canEditTask), so canAccessProject/canEditProject share this.
 */
async function grantsProject(user: SessionUser, projectId: string): Promise<boolean> {
	if (!user) return false;
	const ctx = await projectContext(projectId);
	if (!ctx) return false;
	const role = await memberRole(user.id, ctx.orgId);
	if (!role) return false; // membership prerequisite
	if (isOrgAdminRole(role)) return true;
	if (ctx.wsOwnerId === user.id) return true;
	return hasGrant(user.id, [
		{ type: 'project', id: projectId },
		{ type: 'workspace', id: ctx.workspaceId }
	]);
}

/** Org owner/admin, the workspace owner, or a project/workspace grantee — after org membership. */
export function canEditProject(user: SessionUser, projectId: string): Promise<boolean> {
	return grantsProject(user, projectId);
}

/**
 * Project visibility (ADR-019): inaccessible ≡ missing (caller returns 404).
 * Same set as canEditProject; membership-gated.
 */
export function canAccessProject(user: SessionUser, projectId: string): Promise<boolean> {
	return grantsProject(user, projectId);
}

/** View grant, its project's grant, its workspace (owner/grant), or org owner/admin — membership-gated. */
export async function canEditView(user: SessionUser, viewId: string): Promise<boolean> {
	if (!user) return false;
	const [v] = await db.select({ projectId: view.projectId }).from(view).where(eq(view.id, viewId));
	if (!v) return false;
	const ctx = await projectContext(v.projectId);
	if (!ctx) return false;
	const role = await memberRole(user.id, ctx.orgId);
	if (!role) return false;
	if (isOrgAdminRole(role)) return true;
	if (ctx.wsOwnerId === user.id) return true;
	return hasGrant(user.id, [
		{ type: 'view', id: viewId },
		{ type: 'project', id: v.projectId },
		{ type: 'workspace', id: ctx.workspaceId }
	]);
}

/**
 * Workspace ids visible in `orgId` (ADR-062): membership is required (null role →
 * empty). Org owner/admin see every workspace in the org; a plain member sees
 * only workspaces they own or hold a workspace grant on (∩ the org). NO 'all'
 * sentinel — the return is always a concrete Set so consumers enumerate branches.
 */
export async function accessibleWorkspaceIds(
	user: SessionUser,
	orgId: string | null | undefined
): Promise<Set<string>> {
	if (!user || !orgId) return new Set();
	const role = await memberRole(user.id, orgId);
	if (!role) return new Set(); // membership prerequisite
	const orgWs = await db
		.select({ id: workspace.id, ownerId: workspace.ownerId })
		.from(workspace)
		.where(eq(workspace.organizationId, orgId));
	const orgWsIds = new Set(orgWs.map((w) => w.id));
	if (isOrgAdminRole(role)) return orgWsIds;
	const granted = await db
		.select({ id: permission.resourceId })
		.from(permission)
		.where(
			and(
				eq(permission.userId, user.id),
				eq(permission.resourceType, 'workspace'),
				eq(permission.organizationId, orgId)
			)
		);
	const set = new Set<string>();
	for (const w of orgWs) if (w.ownerId === user.id) set.add(w.id);
	for (const g of granted) if (orgWsIds.has(g.id)) set.add(g.id);
	return set;
}

/** Project ids the user holds direct project grants on, scoped to `orgId` (membership-gated). */
export async function grantedProjectIds(
	user: SessionUser,
	orgId: string | null | undefined
): Promise<Set<string>> {
	if (!user || !orgId) return new Set();
	const role = await memberRole(user.id, orgId);
	if (!role) return new Set();
	const rows = await db
		.select({ id: permission.resourceId })
		.from(permission)
		.where(
			and(
				eq(permission.userId, user.id),
				eq(permission.resourceType, 'project'),
				eq(permission.organizationId, orgId)
			)
		);
	return new Set(rows.map((r) => r.id));
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
 * User ids that can ACCESS a project — the org's owners/admins, the workspace
 * owner, workspace grantees, and direct project grantees. This is the roster
 * offerable as assignees / shown in assignee groupings: ADR-019/ADR-062 say don't
 * leak the whole org's users (names + emails) to everyone who can see a single
 * project. (The all-instance-admins seed of the single-tenant era is removed —
 * instance admins get NO implicit data reach.)
 */
export async function projectAccessUserIds(
	projectId: string,
	workspaceId: string | null
): Promise<Set<string>> {
	const ids = new Set<string>();
	let orgId: string | null = null;

	const pairs: { type: string; id: string }[] = [{ type: 'project', id: projectId }];
	if (workspaceId) {
		const w = await workspaceMeta(workspaceId);
		if (w?.ownerId) ids.add(w.ownerId);
		orgId = w?.orgId ?? null;
		if (orgId) {
			const admins = await db
				.select({ userId: member.userId })
				.from(member)
				.where(and(eq(member.organizationId, orgId), inArray(member.role, ['owner', 'admin'])));
			for (const a of admins) ids.add(a.userId);
		}
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

	// Membership prerequisite (ADR-062 D3): the workspace owner and grant holders are
	// added unconditionally above, but a user who left (or was removed from) the org
	// keeps a surviving workspace-owner reference / inert grant. Intersect the roster
	// with CURRENT members so ex-members drop out of assignee pickers, person-cf
	// validation, mention-notification targets, and export name resolution.
	if (orgId && ids.size > 0) {
		const current = await db
			.select({ userId: member.userId })
			.from(member)
			.where(eq(member.organizationId, orgId));
		const members = new Set(current.map((m) => m.userId));
		for (const id of ids) if (!members.has(id)) ids.delete(id);
	}
	return ids;
}

/** Grant rows on one workspace. */
export async function listWorkspaceGrants(workspaceId: string) {
	return db
		.select()
		.from(permission)
		.where(and(eq(permission.resourceType, 'workspace'), eq(permission.resourceId, workspaceId)));
}
