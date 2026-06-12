import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from './db';
import { permission, task, view } from './db/schema';

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

/** Admins, or users granted edit on the project. */
export async function canEditProject(user: SessionUser, projectId: string) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	return hasGrant(user.id, [{ type: 'project', id: projectId }]);
}

/** View grant or its project's grant. */
export async function canEditView(user: SessionUser, viewId: string) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	const [v] = await db.select().from(view).where(eq(view.id, viewId));
	if (!v) return false;
	return hasGrant(user.id, [
		{ type: 'view', id: viewId },
		{ type: 'project', id: v.projectId }
	]);
}

/** Task grant, parent-task grant (for sub-tasks), or project grant. */
export async function canEditTask(
	user: SessionUser,
	t: { id: string; parentId: string | null; projectId: string }
) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	const pairs = [
		{ type: 'task', id: t.id },
		{ type: 'project', id: t.projectId }
	];
	if (t.parentId) pairs.push({ type: 'task', id: t.parentId });
	return hasGrant(user.id, pairs);
}

export async function canEditTaskById(user: SessionUser, taskId: string) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	const [t] = await db.select().from(task).where(eq(task.id, taskId));
	if (!t) return false;
	return canEditTask(user, t);
}

/** Resource ids (project itself + its views + its tasks) the user holds grants on. */
export async function listProjectGrants(projectId: string) {
	const viewIds = (
		await db.select({ id: view.id }).from(view).where(eq(view.projectId, projectId))
	).map((r) => r.id);
	const taskIds = (
		await db.select({ id: task.id }).from(task).where(eq(task.projectId, projectId))
	).map((r) => r.id);

	const conds = [
		and(eq(permission.resourceType, 'project'), eq(permission.resourceId, projectId))
	];
	if (viewIds.length > 0)
		conds.push(and(eq(permission.resourceType, 'view'), inArray(permission.resourceId, viewIds)));
	if (taskIds.length > 0)
		conds.push(and(eq(permission.resourceType, 'task'), inArray(permission.resourceId, taskIds)));

	return db
		.select()
		.from(permission)
		.where(or(...conds));
}
