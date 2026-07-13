import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	label,
	labelGroup,
	permission,
	project,
	projectLabel,
	task,
	taskLabel,
	user,
	workspace
} from '$lib/server/db/schema';
import { canAccessWorkspace, canEditWorkspace, listWorkspaceGrants } from '$lib/server/permissions';
import { isOrgAdmin, listMembers, orgRole } from '$lib/server/orgs';
import { parseIconValue } from '$lib/server/icons';
import {
	createWorkspaceStatus,
	deleteStatusById,
	listStatuses,
	listWorkspaceStatuses,
	reorderWorkspaceStatuses,
	updateStatusById,
	STATUS_CATEGORIES
} from '$lib/server/statuses';
import {
	createLabel,
	createLabelGroup,
	deleteLabelById,
	deleteLabelGroupById,
	updateLabelById
} from '$lib/server/labels';
import type { Actions, PageServerLoad } from './$types';

async function getWorkspaceOr404(id: string) {
	const [w] = await db.select().from(workspace).where(eq(workspace.id, id));
	if (!w) error(404, 'Workspace not found');
	return w;
}

/** Workspace grants are managed by org owners/admins OR the workspace owner (ADR-062). */
async function canManageGrants(
	user: NonNullable<App.Locals['user']>,
	ws: typeof workspace.$inferSelect
): Promise<boolean> {
	if (ws.ownerId === user.id) return true;
	return ws.organizationId ? isOrgAdmin(user.id, ws.organizationId) : false;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const ws = await getWorkspaceOr404(params.id);
	// ADR-019 tiering: an inaccessible workspace must look identical to a missing
	// one (404, no existence oracle) BEFORE the accessible-but-not-editable 403.
	if (!(await canAccessWorkspace(locals.user, params.id))) error(404, 'Workspace not found');
	if (!(await canEditWorkspace(locals.user, params.id)))
		error(403, 'No edit permission on this workspace');

	const [
		defaults,
		customStatuses,
		labels,
		groups,
		projects,
		members,
		statusUsage,
		taskUse,
		projectUse
	] = await Promise.all([
		listStatuses(),
		listWorkspaceStatuses(params.id),
		db
			.select()
			.from(label)
			.where(eq(label.workspaceId, params.id))
			.orderBy(asc(label.position), asc(label.name)),
		db
			.select()
			.from(labelGroup)
			.where(eq(labelGroup.workspaceId, params.id))
			.orderBy(asc(labelGroup.position), asc(labelGroup.name)),
		db
			.select({ id: project.id, name: project.name })
			.from(project)
			.where(eq(project.workspaceId, params.id))
			.orderBy(asc(project.name)),
		// roster for the grant picker = org members only (ADR-062), not the full user table
		ws.organizationId ? listMembers(ws.organizationId) : Promise.resolve([]),
		// usage counts scoped to this workspace's projects (ADR-062: no instance-wide aggregate)
		db
			.select({ statusId: task.statusId, n: count(task.id) })
			.from(task)
			.innerJoin(project, eq(task.projectId, project.id))
			.where(eq(project.workspaceId, params.id))
			.groupBy(task.statusId),
		db
			.select({ labelId: taskLabel.labelId, n: count() })
			.from(taskLabel)
			.innerJoin(task, eq(taskLabel.taskId, task.id))
			.innerJoin(project, eq(task.projectId, project.id))
			.where(eq(project.workspaceId, params.id))
			.groupBy(taskLabel.labelId),
		db
			.select({ labelId: projectLabel.labelId, n: count() })
			.from(projectLabel)
			.innerJoin(project, eq(projectLabel.projectId, project.id))
			.where(eq(project.workspaceId, params.id))
			.groupBy(projectLabel.labelId)
	]);

	const users = members.map((m) => ({ id: m.userId, name: m.name }));
	const admin = ws.organizationId ? await isOrgAdmin(locals.user!.id, ws.organizationId) : false;
	const owner = ws.ownerId === locals.user!.id;

	return {
		workspace: ws,
		defaults,
		customStatuses: customStatuses.map((s) => ({
			...s,
			inUse: statusUsage.find((u) => u.statusId === s.id)?.n ?? 0
		})),
		categories: STATUS_CATEGORIES,
		groups,
		labels: labels.map((l) => ({
			...l,
			inUse:
				(taskUse.find((u) => u.labelId === l.id)?.n ?? 0) +
				(projectUse.find((u) => u.labelId === l.id)?.n ?? 0)
		})),
		projects,
		// only grant-managers (admin/owner) need the roster — the picker + grant-name
		// lookups are the sole consumers; don't expose all users to other editors.
		users: admin || owner ? users : [],
		grants: admin || owner ? await listWorkspaceGrants(params.id) : [],
		perm: { admin, owner }
	};
};

async function guard(locals: App.Locals, workspaceId: string) {
	if (!locals.user) return fail(401, { message: 'Not signed in' });
	if (!(await canEditWorkspace(locals.user, workspaceId)))
		return fail(403, { message: 'No edit permission on this workspace' });
	return null;
}

export const actions: Actions = {
	updateWorkspace: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Workspace name is required' });
		if (name.length > 120) return fail(400, { message: 'Name too long (max 120)' });

		// per-org name uniqueness (ADR-062)
		const [me] = await db
			.select({ orgId: workspace.organizationId })
			.from(workspace)
			.where(eq(workspace.id, params.id));
		const others = await db
			.select({ id: workspace.id, name: workspace.name })
			.from(workspace)
			.where(me?.orgId ? eq(workspace.organizationId, me.orgId) : undefined);
		if (others.some((w) => w.id !== params.id && w.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A workspace with that name already exists' });

		await db
			.update(workspace)
			.set({ name, updatedAt: new Date() })
			.where(eq(workspace.id, params.id));
		return { success: true };
	},

	deleteWorkspace: async ({ params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const [{ n }] = await db
			.select({ n: count(project.id) })
			.from(project)
			.where(eq(project.workspaceId, params.id));
		if (n > 0) return fail(400, { message: 'Move or delete its projects first' });

		// ADR-062: an empty workspace is deletable even if it's the org's last one
		// (a 0-workspace org is now legal — required for org deletion).

		// permission.resourceId has no FK — clear workspace grants so a future
		// workspace reusing this id can't inherit them
		await db
			.delete(permission)
			.where(and(eq(permission.resourceType, 'workspace'), eq(permission.resourceId, params.id)));
		await db.delete(workspace).where(eq(workspace.id, params.id));
		redirect(303, '/workspaces');
	},

	/* --------------------------- workspace statuses --------------------------- */

	createStatus: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const res = await createWorkspaceStatus(
			params.id,
			{
				name: String(form.get('name') ?? ''),
				description: String(form.get('description') ?? '').trim() || null,
				category: String(form.get('category') ?? 'backlog'),
				color: form.get('color'),
				icon: form.get('icon')
			},
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	updateStatus: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const res = await updateStatusById(
			String(form.get('id') ?? ''),
			{
				name: String(form.get('name') ?? ''),
				description: String(form.get('description') ?? '').trim() || null,
				category: String(form.get('category') ?? 'backlog'),
				color: form.get('color'),
				icon: form.get('icon')
			},
			locals.user,
			{ has: () => true, owner: { workspaceId: params.id } }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	deleteStatus: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const id = String((await request.formData()).get('id') ?? '');
		const res = await deleteStatusById(id, locals.user, { owner: { workspaceId: params.id } });
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/** Reorder this workspace's custom statuses (positions only; category unchanged). */
	reorderStatus: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const ids = String((await request.formData()).get('ids') ?? '').split(',');
		const res = await reorderWorkspaceStatuses(params.id, ids, locals.user);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/* -------------------------------- labels -------------------------------- */

	createGroup: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const name = String((await request.formData()).get('name') ?? '');
		const res = await createLabelGroup(params.id, name, locals.user);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	deleteGroup: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const id = String((await request.formData()).get('id') ?? '');
		const res = await deleteLabelGroupById(id, locals.user, { workspaceId: params.id });
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	createLabel: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const res = await createLabel(
			{ type: 'workspace', id: params.id },
			{
				name: String(form.get('name') ?? ''),
				groupId: String(form.get('groupId') ?? '') || null,
				color: form.get('color'),
				icon: form.get('icon')
			},
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	updateLabel: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const res = await updateLabelById(
			String(form.get('id') ?? ''),
			{ name: String(form.get('name') ?? ''), color: form.get('color'), icon: form.get('icon') },
			locals.user,
			{ has: (key) => form.has(key), owner: { workspaceId: params.id }, emptyOk: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	deleteLabel: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const id = String((await request.formData()).get('id') ?? '');
		const res = await deleteLabelById(id, locals.user, { owner: { workspaceId: params.id } });
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/* -------------------------------- grants -------------------------------- */

	grantPermission: async ({ request, params, locals }) => {
		const ws = await getWorkspaceOr404(params.id);
		if (!locals.user || !(await canManageGrants(locals.user, ws)))
			return fail(403, { message: 'Only org admins or the owner can grant permissions' });

		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		if (!userId) return fail(400, { message: 'Invalid grant' });

		// grantee must be a member of the workspace's org (nonexistent vs out-of-org
		// share one error — no oracle). Grant org == resource org (ADR-062).
		if (!ws.organizationId || !(await orgRole(userId, ws.organizationId)))
			return fail(400, { message: 'Unknown user' });

		await db
			.insert(permission)
			.values({
				id: crypto.randomUUID(),
				userId,
				resourceType: 'workspace',
				resourceId: params.id,
				organizationId: ws.organizationId,
				grantedBy: locals.user.id,
				createdAt: new Date()
			})
			.onConflictDoNothing();
		return { success: true };
	},

	revokePermission: async ({ request, params, locals }) => {
		const ws = await getWorkspaceOr404(params.id);
		if (!locals.user || !(await canManageGrants(locals.user, ws)))
			return fail(403, { message: 'Only org admins or the owner can revoke permissions' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db
			.delete(permission)
			.where(
				and(
					eq(permission.id, id),
					eq(permission.resourceType, 'workspace'),
					eq(permission.resourceId, params.id)
				)
			);
		return { success: true };
	}
};
