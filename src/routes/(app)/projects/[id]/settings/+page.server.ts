import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	label,
	milestone,
	permission,
	project,
	projectDependency,
	projectLabel,
	projectStatus,
	status,
	task,
	user,
	view
} from '$lib/server/db/schema';
import { canEditProject, isAdmin, listProjectGrants } from '$lib/server/permissions';
import {
	listProjectCustomStatuses,
	listStatuses,
	STATUS_CATEGORIES,
	type StatusCategory
} from '$lib/server/statuses';
import type { Actions, PageServerLoad } from './$types';

/** Both app-wide and this project's own statuses are assignable here. */
async function assignableStatuses(projectId: string) {
	const [globals, customs] = await Promise.all([
		listStatuses(),
		listProjectCustomStatuses(projectId)
	]);
	return [...globals, ...customs];
}

function createsCycle(edges: Map<string, string[]>, from: string, to: string) {
	const stack = [to];
	const seen = new Set<string>();
	while (stack.length) {
		const cur = stack.pop()!;
		if (cur === from) return true;
		if (seen.has(cur)) continue;
		seen.add(cur);
		for (const next of edges.get(cur) ?? []) stack.push(next);
	}
	return false;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) error(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		error(403, 'No edit permission on this project');

	const [
		globalStatuses,
		customStatuses,
		eligible,
		labels,
		projLabels,
		projDeps,
		allProjects,
		milestones,
		users,
		views,
		statusUsage
	] = await Promise.all([
		listStatuses(),
		listProjectCustomStatuses(params.id),
		db.select().from(projectStatus).where(eq(projectStatus.projectId, params.id)),
		db.select().from(label).orderBy(asc(label.position), asc(label.name)),
		db.select().from(projectLabel).where(eq(projectLabel.projectId, params.id)),
		db.select().from(projectDependency).where(eq(projectDependency.projectId, params.id)),
		db.select({ id: project.id, name: project.name }).from(project).orderBy(asc(project.name)),
		db
			.select()
			.from(milestone)
			.where(eq(milestone.projectId, params.id))
			.orderBy(asc(milestone.position), asc(milestone.createdAt)),
		db.select({ id: user.id, name: user.name }).from(user).orderBy(asc(user.name)),
		db
			.select({ id: view.id, name: view.name, type: view.type })
			.from(view)
			.where(eq(view.projectId, params.id))
			.orderBy(asc(view.position)),
		db
			.select({ statusId: task.statusId, n: count(task.id) })
			.from(task)
			.where(eq(task.projectId, params.id))
			.groupBy(task.statusId)
	]);

	const admin = isAdmin(locals.user);

	return {
		project: proj,
		globalStatuses,
		customStatuses: customStatuses.map((s) => ({
			...s,
			inUse: statusUsage.find((u) => u.statusId === s.id)?.n ?? 0
		})),
		eligibleStatusIds: eligible.map((e) => e.statusId),
		categories: STATUS_CATEGORIES,
		labels,
		projectLabelIds: projLabels.map((l) => l.labelId),
		projectDependsOn: projDeps.map((d) => d.dependsOnId),
		allProjects,
		milestones,
		users,
		views,
		grants: admin ? await listProjectGrants(params.id) : [],
		perm: { admin }
	};
};

export const actions: Actions = {
	updateProject: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();

		if (!name) return fail(400, { message: 'Project name is required' });

		await db
			.update(project)
			.set({ name, description: description || null, updatedAt: new Date() })
			.where(eq(project.id, params.id));

		return { success: true };
	},

	deleteProject: async ({ params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });
		await db.delete(project).where(eq(project.id, params.id));
		redirect(303, '/projects');
	},

	/* ----------------------- project-scoped statuses ----------------------- */

	createStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const category = String(form.get('category') ?? 'todo');

		if (!name) return fail(400, { message: 'Status name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });
		if (!STATUS_CATEGORIES.includes(category as StatusCategory))
			return fail(400, { message: 'Invalid category' });

		const taken = await assignableStatuses(params.id);
		if (taken.some((s) => s.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A status with that name already exists here' });

		const id = crypto.randomUUID();
		const now = new Date();
		await db.insert(status).values({
			id,
			name,
			category,
			projectId: params.id,
			position: (taken.at(-1)?.position ?? 0) + 10,
			builtIn: false,
			createdAt: now
		});
		// project statuses are eligible in their project by definition
		await db.insert(projectStatus).values({ projectId: params.id, statusId: id });

		return { success: true };
	},

	updateStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const name = String(form.get('name') ?? '').trim();
		const category = String(form.get('category') ?? 'todo');

		const [s] = await db.select().from(status).where(eq(status.id, id));
		if (!s || s.projectId !== params.id)
			return fail(400, { message: 'Not a status of this project' });

		if (!name) return fail(400, { message: 'Status name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });
		if (!STATUS_CATEGORIES.includes(category as StatusCategory))
			return fail(400, { message: 'Invalid category' });

		const taken = await assignableStatuses(params.id);
		if (taken.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A status with that name already exists here' });

		await db.update(status).set({ name, category }).where(eq(status.id, id));
		return { success: true };
	},

	deleteStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const [s] = await db.select().from(status).where(eq(status.id, id));
		if (!s || s.projectId !== params.id)
			return fail(400, { message: 'Not a status of this project' });

		const [{ n }] = await db
			.select({ n: count(task.id) })
			.from(task)
			.where(eq(task.statusId, id));
		if (n > 0) return fail(400, { message: `Status is used by ${n} task(s)` });

		await db.delete(status).where(eq(status.id, id));
		return { success: true };
	},

	updateProjectStatuses: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const statusIds = form.getAll('statusIds').map(String).filter(Boolean);
		if (statusIds.length === 0)
			return fail(400, { message: 'A project needs at least one eligible status' });

		const valid = new Set((await assignableStatuses(params.id)).map((s) => s.id));
		if (!statusIds.every((id) => valid.has(id))) return fail(400, { message: 'Unknown status' });

		const inUse = await db
			.select({ statusId: task.statusId })
			.from(task)
			.where(eq(task.projectId, params.id));
		const keep = new Set(statusIds);
		if (inUse.some((t) => !keep.has(t.statusId)))
			return fail(400, { message: 'Cannot remove a status still used by tasks in this project' });

		await db.delete(projectStatus).where(eq(projectStatus.projectId, params.id));
		await db
			.insert(projectStatus)
			.values(statusIds.map((statusId) => ({ projectId: params.id, statusId })));
		return { success: true };
	},

	/* ------------------------------- labels ------------------------------- */

	toggleProjectLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const labelId = String(form.get('labelId') ?? '');

		const [has] = await db
			.select()
			.from(projectLabel)
			.where(and(eq(projectLabel.projectId, params.id), eq(projectLabel.labelId, labelId)));
		if (has) {
			await db
				.delete(projectLabel)
				.where(and(eq(projectLabel.projectId, params.id), eq(projectLabel.labelId, labelId)));
		} else {
			const [l] = await db.select().from(label).where(eq(label.id, labelId));
			if (!l) return fail(400, { message: 'Unknown label' });
			await db.insert(projectLabel).values({ projectId: params.id, labelId });
		}
		return { success: true };
	},

	/* ---------------------------- dependencies ---------------------------- */

	addProjectDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const dependsOnId = String(form.get('dependsOnId') ?? '');
		if (!dependsOnId || dependsOnId === params.id)
			return fail(400, { message: 'Invalid dependency' });

		const [target] = await db.select().from(project).where(eq(project.id, dependsOnId));
		if (!target) return fail(400, { message: 'Unknown project' });

		const all = await db.select().from(projectDependency);
		const edges = new Map<string, string[]>();
		for (const e of all) edges.set(e.projectId, [...(edges.get(e.projectId) ?? []), e.dependsOnId]);
		if (createsCycle(edges, params.id, dependsOnId))
			return fail(400, { message: 'That dependency would create a cycle' });

		await db
			.insert(projectDependency)
			.values({ projectId: params.id, dependsOnId })
			.onConflictDoNothing();
		return { success: true };
	},

	removeProjectDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const dependsOnId = String(form.get('dependsOnId') ?? '');
		await db
			.delete(projectDependency)
			.where(
				and(
					eq(projectDependency.projectId, params.id),
					eq(projectDependency.dependsOnId, dependsOnId)
				)
			);
		return { success: true };
	},

	/* ----------------------------- milestones ----------------------------- */

	createMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const targetDateRaw = String(form.get('targetDate') ?? '');

		if (!name) return fail(400, { message: 'Milestone name is required' });

		const now = new Date();
		await db.insert(milestone).values({
			id: crypto.randomUUID(),
			projectId: params.id,
			name,
			targetDate: targetDateRaw ? new Date(targetDateRaw + 'T00:00:00') : null,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});
		return { success: true };
	},

	deleteMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(milestone).where(and(eq(milestone.id, id), eq(milestone.projectId, params.id)));
		return { success: true };
	},

	/* ----------------------------- permissions ----------------------------- */

	grantPermission: async ({ request, params, locals }) => {
		if (!locals.user || !isAdmin(locals.user))
			return fail(403, { message: 'Only admins can grant permissions' });

		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const resourceType = String(form.get('resourceType') ?? '');
		const resourceId = String(form.get('resourceId') ?? '');

		if (!userId || !['project', 'view'].includes(resourceType) || !resourceId)
			return fail(400, { message: 'Invalid grant' });
		if (resourceType === 'project' && resourceId !== params.id)
			return fail(400, { message: 'Invalid grant' });
		if (resourceType === 'view') {
			const [v] = await db.select().from(view).where(eq(view.id, resourceId));
			if (!v || v.projectId !== params.id) return fail(400, { message: 'Invalid view' });
		}

		await db
			.insert(permission)
			.values({
				id: crypto.randomUUID(),
				userId,
				resourceType,
				resourceId,
				grantedBy: locals.user.id,
				createdAt: new Date()
			})
			.onConflictDoNothing();
		return { success: true };
	},

	revokePermission: async ({ request, locals }) => {
		if (!locals.user || !isAdmin(locals.user))
			return fail(403, { message: 'Only admins can revoke permissions' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(permission).where(eq(permission.id, id));
		return { success: true };
	}
};
