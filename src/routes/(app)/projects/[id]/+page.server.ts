import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	label,
	labelGroup,
	milestone,
	permission,
	project,
	projectDependency,
	projectLabel,
	projectStatus,
	task,
	taskDependency,
	taskLabel,
	user,
	view
} from '$lib/server/db/schema';
import { dispatchEvent } from '$lib/server/integrations';
import { canEditProject, canEditTask, canEditView, isAdmin, listProjectGrants } from '$lib/server/permissions';
import { listProjectStatuses, listStatuses } from '$lib/server/statuses';
import { VIEW_TYPES, type ViewType } from '$lib/server/projects';
import type { Actions, PageServerLoad } from './$types';

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

async function getTask(id: string) {
	const [t] = await db.select().from(task).where(eq(task.id, id));
	return t ?? null;
}

/** True if adding edge from -> to creates a cycle (graph: id -> dependsOn ids). */
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

	const [
		tasks,
		users,
		views,
		eligibleStatuses,
		allStatuses,
		milestones,
		labels,
		labelGroups,
		projLabels,
		projDeps,
		allProjects,
		taskDeps
	] = await Promise.all([
		db
			.select()
			.from(task)
			.where(eq(task.projectId, params.id))
			.orderBy(asc(task.position), asc(task.createdAt)),
		db.select({ id: user.id, name: user.name, email: user.email }).from(user).orderBy(asc(user.name)),
		db
			.select()
			.from(view)
			.where(eq(view.projectId, params.id))
			.orderBy(asc(view.position), asc(view.createdAt)),
		listProjectStatuses(params.id),
		listStatuses(),
		db
			.select()
			.from(milestone)
			.where(eq(milestone.projectId, params.id))
			.orderBy(asc(milestone.position), asc(milestone.createdAt)),
		db.select().from(label).orderBy(asc(label.position), asc(label.name)),
		db.select().from(labelGroup).orderBy(asc(labelGroup.position), asc(labelGroup.name)),
		db.select().from(projectLabel).where(eq(projectLabel.projectId, params.id)),
		db.select().from(projectDependency).where(eq(projectDependency.projectId, params.id)),
		db
			.select({ id: project.id, name: project.name })
			.from(project)
			.orderBy(asc(project.name)),
		db
			.select({ taskId: taskDependency.taskId, dependsOnId: taskDependency.dependsOnId })
			.from(taskDependency)
			.innerJoin(task, eq(taskDependency.taskId, task.id))
			.where(eq(task.projectId, params.id))
	]);

	const taskIds = tasks.map((t) => t.id);
	const tLabels =
		taskIds.length > 0
			? await db.select().from(taskLabel).where(inArray(taskLabel.taskId, taskIds))
			: [];

	const admin = isAdmin(locals.user);
	const canEditProj = await canEditProject(locals.user, params.id);

	// Per-view edit rights (project grant covers all views)
	const editableViews: Record<string, boolean> = {};
	for (const v of views) {
		editableViews[v.id] = canEditProj || (await canEditView(locals.user, v.id));
	}

	const grants = admin ? await listProjectGrants(params.id) : [];

	return {
		project: proj,
		tasks,
		users,
		views,
		statuses: eligibleStatuses,
		allStatuses,
		milestones,
		labels,
		labelGroups,
		projectLabelIds: projLabels.map((l) => l.labelId),
		taskLabels: tLabels,
		projectDependsOn: projDeps.map((d) => d.dependsOnId),
		allProjects,
		taskDeps,
		perm: { admin, project: canEditProj, views: editableViews },
		grants
	};
};

export const actions: Actions = {
	/* ------------------------------ tasks ------------------------------ */

	createTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const parentId = String(form.get('parentId') ?? '') || null;
		const priority = String(form.get('priority') ?? 'none');

		if (!title) return fail(400, { message: 'Task title is required' });
		if (title.length > 240) return fail(400, { message: 'Title too long (max 240)' });
		if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number]))
			return fail(400, { message: 'Invalid priority' });

		if (parentId) {
			const parent = await getTask(parentId);
			if (!parent || parent.projectId !== params.id)
				return fail(400, { message: 'Invalid parent task' });
			if (parent.parentId)
				return fail(400, { message: 'Sub-tasks cannot have their own sub-tasks' });
		}

		const eligible = await listProjectStatuses(params.id);
		const requestedStatusId = String(form.get('statusId') ?? '');
		let defaultStatus = requestedStatusId
			? eligible.find((s) => s.id === requestedStatusId)
			: undefined;
		if (requestedStatusId && !defaultStatus)
			return fail(400, { message: 'Status not eligible for this project' });
		defaultStatus ??= eligible.find((s) => s.category === 'todo') ?? eligible[0];
		if (!defaultStatus) return fail(400, { message: 'Project has no eligible statuses' });

		const now = new Date();
		await db.insert(task).values({
			id: crypto.randomUUID(),
			projectId: params.id,
			parentId,
			title,
			priority,
			statusId: defaultStatus.id,
			createdBy: locals.user.id,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});

		const [proj] = await db.select().from(project).where(eq(project.id, params.id));
		void dispatchEvent({
			type: 'task.created',
			actor: locals.user.name,
			projectName: proj?.name ?? 'Unknown project',
			taskTitle: title
		});

		return { success: true };
	},

	setStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const statusId = String(form.get('statusId') ?? '');

		const existing = await getTask(id);
		if (!existing || existing.projectId !== params.id)
			return fail(400, { message: 'Invalid task' });
		if (!(await canEditTask(locals.user, existing)))
			return fail(403, { message: 'No edit permission on this task' });

		const eligible = await listProjectStatuses(params.id);
		const target = eligible.find((s) => s.id === statusId);
		if (!target) return fail(400, { message: 'Status not eligible for this project' });

		await db.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.id, id));

		// Completing a parent completes its sub-tasks
		if (target.category === 'done') {
			await db
				.update(task)
				.set({ statusId, updatedAt: new Date() })
				.where(eq(task.parentId, id));
		}

		const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'done';
		if (target.category === 'done' && !wasDone) {
			const [proj] = await db.select().from(project).where(eq(project.id, existing.projectId));
			void dispatchEvent({
				type: 'task.completed',
				actor: locals.user.name,
				projectName: proj?.name ?? 'Unknown project',
				taskTitle: existing.title
			});
		}

		return { success: true };
	},

	/** Board drag-and-drop: move a task to a status column, ordered before `beforeId` (or end). */
	moveTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const statusId = String(form.get('statusId') ?? '');
		const beforeId = String(form.get('beforeId') ?? '') || null;

		const existing = await getTask(id);
		if (!existing || existing.projectId !== params.id || existing.parentId)
			return fail(400, { message: 'Invalid task' });
		if (!(await canEditTask(locals.user, existing)))
			return fail(403, { message: 'No edit permission on this task' });

		const eligible = await listProjectStatuses(params.id);
		const target = eligible.find((s) => s.id === statusId);
		if (!target) return fail(400, { message: 'Status not eligible for this project' });

		const colTasks = (
			await db
				.select()
				.from(task)
				.where(
					and(
						eq(task.projectId, params.id),
						eq(task.statusId, statusId),
						isNull(task.parentId)
					)
				)
				.orderBy(asc(task.position), asc(task.createdAt))
		).filter((t) => t.id !== id);

		let idx = beforeId ? colTasks.findIndex((t) => t.id === beforeId) : colTasks.length;
		if (idx < 0) idx = colTasks.length;
		const prev = colTasks[idx - 1]?.position;
		const next = colTasks[idx]?.position;

		let position: number;
		if (prev === undefined && next === undefined) {
			position = Date.now();
		} else if (prev === undefined) {
			position = next! - 1024;
		} else if (next === undefined) {
			position = prev + 1024;
		} else if (next - prev > 1) {
			position = Math.floor((prev + next) / 2);
		} else {
			// no gap left between neighbors — renumber the column
			for (let i = 0; i < colTasks.length; i++) {
				await db
					.update(task)
					.set({ position: (i + (i >= idx ? 1 : 0)) * 1024 })
					.where(eq(task.id, colTasks[i].id));
			}
			position = idx * 1024;
		}

		await db
			.update(task)
			.set({ statusId, position, updatedAt: new Date() })
			.where(eq(task.id, id));

		const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'done';
		if (target.category === 'done') {
			await db
				.update(task)
				.set({ statusId, updatedAt: new Date() })
				.where(eq(task.parentId, id));
		}
		if (target.category === 'done' && !wasDone) {
			const [proj] = await db.select().from(project).where(eq(project.id, params.id));
			void dispatchEvent({
				type: 'task.completed',
				actor: locals.user.name,
				projectName: proj?.name ?? 'Unknown project',
				taskTitle: existing.title
			});
		}

		return { success: true };
	},

	updateTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		const priority = String(form.get('priority') ?? 'none');
		const assigneeId = String(form.get('assigneeId') ?? '') || null;
		const milestoneId = String(form.get('milestoneId') ?? '') || null;
		const location = String(form.get('location') ?? '').trim() || null;
		const dueDateRaw = String(form.get('dueDate') ?? '');

		const existing = await getTask(id);
		if (!existing || existing.projectId !== params.id)
			return fail(400, { message: 'Invalid task' });
		if (!(await canEditTask(locals.user, existing)))
			return fail(403, { message: 'No edit permission on this task' });

		if (!title) return fail(400, { message: 'Task title is required' });
		if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number]))
			return fail(400, { message: 'Invalid priority' });

		if (milestoneId) {
			const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
			if (!m || m.projectId !== params.id)
				return fail(400, { message: 'Milestone must belong to this project' });
		}

		if (location && !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(location))
			return fail(400, { message: 'Location must be "lat, lng"' });

		const dueDate = dueDateRaw ? new Date(dueDateRaw + 'T00:00:00') : null;

		// order only updates when the form includes it (older forms don't)
		let order: number | null | undefined = undefined;
		if (form.has('order')) {
			const orderRaw = String(form.get('order') ?? '').trim();
			if (orderRaw === '') {
				order = null;
			} else {
				order = Number(orderRaw);
				if (!Number.isInteger(order)) return fail(400, { message: 'Order must be a whole number' });
			}
		}

		await db
			.update(task)
			.set({
				title,
				description: description || null,
				priority,
				assigneeId,
				milestoneId,
				location,
				...(order !== undefined ? { order } : {}),
				dueDate,
				updatedAt: new Date()
			})
			.where(eq(task.id, id));

		return { success: true };
	},

	deleteTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const existing = await getTask(id);
		if (!existing || existing.projectId !== params.id)
			return fail(400, { message: 'Invalid task' });
		if (!(await canEditTask(locals.user, existing)))
			return fail(403, { message: 'No edit permission on this task' });

		await db.delete(task).where(eq(task.parentId, id)); // sub-tasks first
		await db.delete(task).where(eq(task.id, id));
		return { success: true };
	},

	toggleTaskLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		const labelId = String(form.get('labelId') ?? '');

		const existing = await getTask(taskId);
		if (!existing || existing.projectId !== params.id)
			return fail(400, { message: 'Invalid task' });
		if (!(await canEditTask(locals.user, existing)))
			return fail(403, { message: 'No edit permission on this task' });

		const [has] = await db
			.select()
			.from(taskLabel)
			.where(and(eq(taskLabel.taskId, taskId), eq(taskLabel.labelId, labelId)));
		if (has) {
			await db
				.delete(taskLabel)
				.where(and(eq(taskLabel.taskId, taskId), eq(taskLabel.labelId, labelId)));
		} else {
			const [l] = await db.select().from(label).where(eq(label.id, labelId));
			if (!l) return fail(400, { message: 'Unknown label' });
			await db.insert(taskLabel).values({ taskId, labelId });
		}
		return { success: true };
	},

	/* --------------------------- dependencies -------------------------- */

	addTaskDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		const dependsOnId = String(form.get('dependsOnId') ?? '');

		if (taskId === dependsOnId) return fail(400, { message: 'A task cannot depend on itself' });

		const [t, dep] = await Promise.all([getTask(taskId), getTask(dependsOnId)]);
		if (!t || !dep || t.projectId !== params.id || dep.projectId !== params.id)
			return fail(400, { message: 'Both tasks must belong to this project' });
		if (!(await canEditTask(locals.user, t)))
			return fail(403, { message: 'No edit permission on this task' });

		// Sub-tasks may only depend on sibling sub-tasks; top-level on top-level
		if (t.parentId || dep.parentId) {
			if (t.parentId !== dep.parentId)
				return fail(400, { message: 'Sub-tasks can only depend on sub-tasks of the same task' });
		}

		const all = await db
			.select({ taskId: taskDependency.taskId, dependsOnId: taskDependency.dependsOnId })
			.from(taskDependency)
			.innerJoin(task, eq(taskDependency.taskId, task.id))
			.where(eq(task.projectId, params.id));
		const edges = new Map<string, string[]>();
		for (const e of all) edges.set(e.taskId, [...(edges.get(e.taskId) ?? []), e.dependsOnId]);
		if (createsCycle(edges, taskId, dependsOnId))
			return fail(400, { message: 'That dependency would create a cycle' });

		await db
			.insert(taskDependency)
			.values({ taskId, dependsOnId })
			.onConflictDoNothing();
		return { success: true };
	},

	removeTaskDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		const dependsOnId = String(form.get('dependsOnId') ?? '');

		const t = await getTask(taskId);
		if (!t || t.projectId !== params.id) return fail(400, { message: 'Invalid task' });
		if (!(await canEditTask(locals.user, t)))
			return fail(403, { message: 'No edit permission on this task' });

		await db
			.delete(taskDependency)
			.where(and(eq(taskDependency.taskId, taskId), eq(taskDependency.dependsOnId, dependsOnId)));
		return { success: true };
	},

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
		for (const e of all)
			edges.set(e.projectId, [...(edges.get(e.projectId) ?? []), e.dependsOnId]);
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

	/* ------------------------------ views ------------------------------ */

	createView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const type = String(form.get('type') ?? 'table');

		if (!name) return fail(400, { message: 'View name is required' });
		if (!VIEW_TYPES.includes(type as ViewType)) return fail(400, { message: 'Invalid view type' });

		const now = new Date();
		const id = crypto.randomUUID();
		await db.insert(view).values({
			id,
			projectId: params.id,
			name,
			type,
			config: '{}',
			position: now.getTime(),
			createdBy: locals.user.id,
			createdAt: now,
			updatedAt: now
		});

		return { success: true, viewId: id };
	},

	updateView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const name = String(form.get('name') ?? '').trim();
		const type = String(form.get('type') ?? 'table');
		const configRaw = String(form.get('config') ?? '{}');

		const [v] = await db.select().from(view).where(eq(view.id, id));
		if (!v || v.projectId !== params.id) return fail(400, { message: 'Invalid view' });
		if (!(await canEditView(locals.user, id)))
			return fail(403, { message: 'No edit permission on this view' });

		if (!name) return fail(400, { message: 'View name is required' });
		if (!VIEW_TYPES.includes(type as ViewType)) return fail(400, { message: 'Invalid view type' });

		let config = '{}';
		try {
			const parsed = JSON.parse(configRaw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
				config = JSON.stringify(parsed);
		} catch {
			return fail(400, { message: 'Invalid view config' });
		}

		await db
			.update(view)
			.set({ name, type, config, updatedAt: new Date() })
			.where(eq(view.id, id));

		return { success: true };
	},

	deleteView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const [v] = await db.select().from(view).where(eq(view.id, id));
		if (!v || v.projectId !== params.id) return fail(400, { message: 'Invalid view' });
		if (!(await canEditView(locals.user, id)))
			return fail(403, { message: 'No edit permission on this view' });

		const views = await db.select({ id: view.id }).from(view).where(eq(view.projectId, params.id));
		if (views.length <= 1)
			return fail(400, { message: 'A project must have at least one view' });

		await db.delete(view).where(eq(view.id, id));
		return { success: true };
	},

	/* ---------------------------- milestones ---------------------------- */

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
		await db
			.delete(milestone)
			.where(and(eq(milestone.id, id), eq(milestone.projectId, params.id)));
		return { success: true };
	},

	/* ------------------------- project settings ------------------------- */

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

	updateProjectStatuses: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const statusIds = form.getAll('statusIds').map(String).filter(Boolean);
		if (statusIds.length === 0)
			return fail(400, { message: 'A project needs at least one eligible status' });

		const all = await listStatuses();
		const valid = new Set(all.map((s) => s.id));
		if (!statusIds.every((id) => valid.has(id)))
			return fail(400, { message: 'Unknown status' });

		// Block removing a status still used by this project's tasks
		const inUse = await db
			.select({ statusId: task.statusId })
			.from(task)
			.where(eq(task.projectId, params.id));
		const keep = new Set(statusIds);
		const blocked = inUse.find((t) => !keep.has(t.statusId));
		if (blocked)
			return fail(400, { message: 'Cannot remove a status still used by tasks in this project' });

		await db.delete(projectStatus).where(eq(projectStatus.projectId, params.id));
		await db
			.insert(projectStatus)
			.values(statusIds.map((statusId) => ({ projectId: params.id, statusId })));
		return { success: true };
	},

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

	deleteProject: async ({ params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });
		await db.delete(project).where(eq(project.id, params.id));
		redirect(303, '/projects');
	},

	/* ---------------------------- permissions ---------------------------- */

	grantPermission: async ({ request, params, locals }) => {
		if (!locals.user || !isAdmin(locals.user))
			return fail(403, { message: 'Only admins can grant permissions' });

		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const resourceType = String(form.get('resourceType') ?? '');
		const resourceId = String(form.get('resourceId') ?? '');

		// Tasks are member-editable by default — grants only apply to structure
		if (!userId || !['project', 'view'].includes(resourceType) || !resourceId)
			return fail(400, { message: 'Invalid grant' });

		// Resource must belong to this project
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
