import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	label,
	labelGroup,
	permission,
	project,
	projectLabel,
	status,
	task,
	taskLabel,
	user,
	workspace
} from '$lib/server/db/schema';
import { canEditWorkspace, isAdmin, listWorkspaceGrants } from '$lib/server/permissions';
import { parseIconValue } from '$lib/server/icons';
import {
	listStatuses,
	listWorkspaceStatuses,
	STATUS_CATEGORIES,
	type StatusCategory
} from '$lib/server/statuses';
import type { Actions, PageServerLoad } from './$types';

async function getWorkspaceOr404(id: string) {
	const [w] = await db.select().from(workspace).where(eq(workspace.id, id));
	if (!w) error(404, 'Workspace not found');
	return w;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const ws = await getWorkspaceOr404(params.id);
	if (!(await canEditWorkspace(locals.user, params.id)))
		error(403, 'No edit permission on this workspace');

	const [defaults, customStatuses, labels, groups, projects, users, statusUsage, taskUse, projectUse] =
		await Promise.all([
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
			db.select({ id: user.id, name: user.name }).from(user).orderBy(asc(user.name)),
			db
				.select({ statusId: task.statusId, n: count(task.id) })
				.from(task)
				.groupBy(task.statusId),
			db
				.select({ labelId: taskLabel.labelId, n: count() })
				.from(taskLabel)
				.groupBy(taskLabel.labelId),
			db
				.select({ labelId: projectLabel.labelId, n: count() })
				.from(projectLabel)
				.groupBy(projectLabel.labelId)
		]);

	const admin = isAdmin(locals.user);
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
		users,
		grants: admin || owner ? await listWorkspaceGrants(params.id) : [],
		perm: { admin, owner }
	};
};

/** Accept a #rrggbb hex color, else null. */
function parseColor(v: FormDataEntryValue | null): string | null {
	const s = String(v ?? '').trim();
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

async function guard(locals: App.Locals, workspaceId: string) {
	if (!locals.user) return fail(401, { message: 'Not signed in' });
	if (!(await canEditWorkspace(locals.user, workspaceId)))
		return fail(403, { message: 'No edit permission on this workspace' });
	return null;
}

/** Names a new/renamed workspace status must not collide with: defaults,
 * workspace siblings, AND statuses owned by this workspace's projects. */
async function takenStatusNames(workspaceId: string) {
	const projectIds = (
		await db
			.select({ id: project.id })
			.from(project)
			.where(eq(project.workspaceId, workspaceId))
	).map((p) => p.id);
	const projectStatuses =
		projectIds.length > 0
			? await db.select().from(status).where(inArray(status.projectId, projectIds))
			: [];
	return [...(await listStatuses()), ...(await listWorkspaceStatuses(workspaceId)), ...projectStatuses];
}

export const actions: Actions = {
	updateWorkspace: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Workspace name is required' });
		if (name.length > 120) return fail(400, { message: 'Name too long (max 120)' });

		const others = await db.select({ id: workspace.id, name: workspace.name }).from(workspace);
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

		const [{ n: total }] = await db.select({ n: count(workspace.id) }).from(workspace);
		if (total <= 1) return fail(400, { message: 'At least one workspace must exist' });

		// permission.resourceId has no FK — clear workspace grants so a future
		// workspace reusing this id (e.g. workspace-default) can't inherit them
		await db
			.delete(permission)
			.where(
				and(eq(permission.resourceType, 'workspace'), eq(permission.resourceId, params.id))
			);
		await db.delete(workspace).where(eq(workspace.id, params.id));
		redirect(303, '/workspaces');
	},

	/* --------------------------- workspace statuses --------------------------- */

	createStatus: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim() || null;
		const category = String(form.get('category') ?? 'backlog');

		if (!name) return fail(400, { message: 'Status name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });
		if (description && description.length > 200) return fail(400, { message: 'Description too long (max 200)' });
		if (!STATUS_CATEGORIES.includes(category as StatusCategory))
			return fail(400, { message: 'Invalid category' });

		const color = parseColor(form.get('color'));
		const icon = parseIconValue(form.get('icon'));

		const taken = await takenStatusNames(params.id);
		if (taken.some((s) => s.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A status with that name already exists here' });

		await db.insert(status).values({
			id: crypto.randomUUID(),
			name,
			description,
			category,
			color,
			icon,
			workspaceId: params.id,
			position: (taken.at(-1)?.position ?? 0) + 10,
			builtIn: false,
			createdAt: new Date()
		});
		return { success: true };
	},

	updateStatus: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim() || null;
		const category = String(form.get('category') ?? 'backlog');

		const [s] = await db.select().from(status).where(eq(status.id, id));
		if (!s || s.workspaceId !== params.id)
			return fail(400, { message: 'Not a status of this workspace' });

		if (!name) return fail(400, { message: 'Status name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });
		if (description && description.length > 200) return fail(400, { message: 'Description too long (max 200)' });
		if (!STATUS_CATEGORIES.includes(category as StatusCategory))
			return fail(400, { message: 'Invalid category' });

		const color = parseColor(form.get('color'));
		const icon = parseIconValue(form.get('icon'));

		const taken = await takenStatusNames(params.id);
		if (taken.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A status with that name already exists here' });

		await db.update(status).set({ name, description, category, color, icon }).where(eq(status.id, id));
		return { success: true };
	},

	deleteStatus: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const [s] = await db.select().from(status).where(eq(status.id, id));
		if (!s || s.workspaceId !== params.id)
			return fail(400, { message: 'Not a status of this workspace' });

		const [{ n }] = await db
			.select({ n: count(task.id) })
			.from(task)
			.where(eq(task.statusId, id));
		if (n > 0) return fail(400, { message: `Status is used by ${n} task(s)` });

		await db.delete(status).where(eq(status.id, id));
		return { success: true };
	},

	/** Reorder this workspace's custom statuses (positions only; category unchanged). */
	reorderStatus: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const ids = String((await request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		const owned = await listWorkspaceStatuses(params.id);
		const ownedIds = new Set(owned.map((s) => s.id));
		if (ids.length !== owned.length || !ids.every((id) => ownedIds.has(id)))
			return fail(400, { message: 'Invalid order' });

		// keep customs sorted after the built-in defaults globally
		const base = Math.max(0, ...(await listStatuses()).map((d) => d.position)) + 10;
		for (let i = 0; i < ids.length; i++)
			await db.update(status).set({ position: base + i * 10 }).where(eq(status.id, ids[i]));
		return { success: true };
	},

	/* -------------------------------- labels -------------------------------- */

	createGroup: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Group name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });

		const existing = await db
			.select({ name: labelGroup.name })
			.from(labelGroup)
			.where(eq(labelGroup.workspaceId, params.id));
		if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A group with that name exists' });

		await db.insert(labelGroup).values({
			id: crypto.randomUUID(),
			name,
			workspaceId: params.id,
			position: Date.now(),
			createdAt: new Date()
		});
		return { success: true };
	},

	deleteGroup: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		// labels in the group survive (groupId set null via FK)
		await db
			.delete(labelGroup)
			.where(and(eq(labelGroup.id, id), eq(labelGroup.workspaceId, params.id)));
		return { success: true };
	},

	createLabel: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const groupId = String(form.get('groupId') ?? '') || null;

		if (!name) return fail(400, { message: 'Label name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });

		const existing = await db
			.select({ name: label.name })
			.from(label)
			.where(eq(label.workspaceId, params.id));
		if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A label with that name exists' });

		if (groupId) {
			const [g] = await db.select().from(labelGroup).where(eq(labelGroup.id, groupId));
			if (!g || g.workspaceId !== params.id) return fail(400, { message: 'Unknown group' });
		}

		await db.insert(label).values({
			id: crypto.randomUUID(),
			name,
			workspaceId: params.id,
			groupId,
			position: Date.now(),
			createdAt: new Date()
		});
		return { success: true };
	},

	deleteLabel: async ({ request, params, locals }) => {
		const denied = await guard(locals, params.id);
		if (denied) return denied;

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(label).where(and(eq(label.id, id), eq(label.workspaceId, params.id)));
		return { success: true };
	},

	/* -------------------------------- grants -------------------------------- */

	grantPermission: async ({ request, params, locals }) => {
		const ws = await getWorkspaceOr404(params.id);
		if (!locals.user || !(isAdmin(locals.user) || ws.ownerId === locals.user.id))
			return fail(403, { message: 'Only admins or the owner can grant permissions' });

		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		if (!userId) return fail(400, { message: 'Invalid grant' });

		const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
		if (!u) return fail(400, { message: 'Unknown user' });

		await db
			.insert(permission)
			.values({
				id: crypto.randomUUID(),
				userId,
				resourceType: 'workspace',
				resourceId: params.id,
				grantedBy: locals.user.id,
				createdAt: new Date()
			})
			.onConflictDoNothing();
		return { success: true };
	},

	revokePermission: async ({ request, params, locals }) => {
		const ws = await getWorkspaceOr404(params.id);
		if (!locals.user || !(isAdmin(locals.user) || ws.ownerId === locals.user.id))
			return fail(403, { message: 'Only admins or the owner can revoke permissions' });

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
