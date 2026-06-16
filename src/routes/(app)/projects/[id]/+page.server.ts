import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, count, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	customField,
	file,
	label,
	labelGroup,
	location,
	milestone,
	milestoneDependency,
	permission,
	project,
	projectDependency,
	projectLabel,
	projectStatus,
	task,
	taskCustomValue,
	taskDependency,
	taskLabel,
	template,
	user,
	view
} from '$lib/server/db/schema';
import { dispatchEvent } from '$lib/server/integrations';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import {
	logActivity,
	createComment,
	updateComment,
	deleteComment,
	getComment
} from '$lib/server/comments';
import { listSavedFilters, createSavedFilter, deleteSavedFilter } from '$lib/server/savedFilters';
import {
	listTemplatesForProject,
	createTemplate,
	updateTemplatePayload,
	getTemplate,
	deleteTemplate,
	instantiateTemplate,
	buildPayloadFromTask
} from '$lib/server/templates';
import { isValidRecurrence, nextDueDate } from '$lib/recurrence';
import {
	listCustomFieldOptions,
	listProjectCustomFields,
	writeTaskCustomValues
} from '$lib/server/customFields';
import {
	accessibleWorkspaceIds,
	canAccessProject,
	canEditProject,
	canEditTask,
	canEditView,
	canEditWorkspace,
	grantedProjectIds,
	isAdmin
} from '$lib/server/permissions';
import { listProjectStatuses, listStatuses, listWorkspaceStatuses } from '$lib/server/statuses';
import { ICONOIR_NAMES } from '$lib/iconoirNames';
import { VIEW_TYPES, type ViewType } from '$lib/server/projects';
import type { Actions, PageServerLoad } from './$types';

/** Statuses assignable to the PROJECT itself: defaults + its workspace's. */
async function projectStatusOptions(workspaceId: string | null) {
	return [
		...(await listStatuses()),
		...(workspaceId ? await listWorkspaceStatuses(workspaceId) : [])
	];
}

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

/** Pull custom-field values from a task form: keys `cf_<fieldId>` (one per field). */
function cfEntries(form: FormData): { fieldId: string; raw: string }[] {
	const seen = new Set<string>();
	const out: { fieldId: string; raw: string }[] = [];
	for (const key of form.keys()) {
		if (!key.startsWith('cf_') || seen.has(key)) continue;
		seen.add(key);
		out.push({ fieldId: key.slice(3), raw: String(form.get(key) ?? '') });
	}
	return out;
}

async function getTask(id: string) {
	const [t] = await db.select().from(task).where(eq(task.id, id));
	return t ?? null;
}

/** Parse the optional latitude/longitude form fields (blank ⇒ null), range-checked. */
function parseCoords(form: FormData): { lat: number | null; lng: number | null } | { error: string } {
	const latRaw = String(form.get('latitude') ?? '').trim();
	const lngRaw = String(form.get('longitude') ?? '').trim();
	let lat: number | null = null;
	let lng: number | null = null;
	if (latRaw !== '') {
		lat = Number(latRaw);
		if (!Number.isFinite(lat) || lat < -90 || lat > 90)
			return { error: 'Latitude must be between -90 and 90' };
	}
	if (lngRaw !== '') {
		lng = Number(lngRaw);
		if (!Number.isFinite(lng) || lng < -180 || lng > 180)
			return { error: 'Longitude must be between -180 and 180' };
	}
	return { lat, lng };
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
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) error(404, 'Project not found');

	const [
		tasks,
		users,
		views,
		eligibleStatuses,
		milestones,
		labels,
		labelGroups,
		projLabels,
		projDeps,
		allProjects,
		taskDeps,
		milestoneDeps
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
		db
			.select()
			.from(milestone)
			.where(eq(milestone.projectId, params.id))
			.orderBy(asc(milestone.position), asc(milestone.createdAt)),
		db
			.select()
			.from(label)
			.where(
				proj.workspaceId
					? or(eq(label.workspaceId, proj.workspaceId), eq(label.projectId, params.id))
					: eq(label.projectId, params.id)
			)
			.orderBy(asc(label.position), asc(label.name)),
		proj.workspaceId
			? db
					.select()
					.from(labelGroup)
					.where(eq(labelGroup.workspaceId, proj.workspaceId))
					.orderBy(asc(labelGroup.position), asc(labelGroup.name))
			: Promise.resolve([]),
		db.select().from(projectLabel).where(eq(projectLabel.projectId, params.id)),
		db.select().from(projectDependency).where(eq(projectDependency.projectId, params.id)),
		db
			.select({ id: project.id, name: project.name, workspaceId: project.workspaceId })
			.from(project)
			.orderBy(asc(project.name)),
		db
			.select({ taskId: taskDependency.taskId, dependsOnId: taskDependency.dependsOnId })
			.from(taskDependency)
			.innerJoin(task, eq(taskDependency.taskId, task.id))
			.where(eq(task.projectId, params.id)),
		db
			.select({
				milestoneId: milestoneDependency.milestoneId,
				dependsOnId: milestoneDependency.dependsOnId
			})
			.from(milestoneDependency)
			.innerJoin(milestone, eq(milestoneDependency.milestoneId, milestone.id))
			.where(eq(milestone.projectId, params.id))
	]);

	const taskIds = tasks.map((t) => t.id);
	const tLabels =
		taskIds.length > 0
			? await db.select().from(taskLabel).where(inArray(taskLabel.taskId, taskIds))
			: [];

	const locations = await db
		.select()
		.from(location)
		.where(eq(location.projectId, params.id))
		.orderBy(asc(location.position), asc(location.title));

	// Task-facing custom fields only — entity='project' fields live in project settings.
	const customFields = (await listProjectCustomFields(params.id)).filter(
		(f) => (f.entity ?? 'task') !== 'project'
	);
	const [customFieldOptions, taskCustomValues, files] = await Promise.all([
		listCustomFieldOptions(customFields.map((f) => f.id)),
		taskIds.length > 0
			? db
					.select()
					.from(taskCustomValue)
					.where(inArray(taskCustomValue.taskId, taskIds))
			: Promise.resolve([]),
		db
			.select({
				id: file.id,
				taskId: file.taskId,
				fieldId: file.fieldId,
				filename: file.filename,
				mimeType: file.mimeType,
				size: file.size
			})
			.from(file)
			.where(eq(file.projectId, params.id))
	]);

	const savedFilters = await listSavedFilters(params.id);
	const templates = await listTemplatesForProject(params.id);

	const admin = isAdmin(locals.user);
	const canEditProj = await canEditProject(locals.user, params.id);

	// ADR-019: dependency picker offers only accessible projects
	const [wsAccess, projGrants] = await Promise.all([
		accessibleWorkspaceIds(locals.user),
		grantedProjectIds(locals.user)
	]);
	const visibleProjects =
		wsAccess === 'all'
			? allProjects
			: allProjects.filter(
					(p) =>
						(p.workspaceId && wsAccess.has(p.workspaceId)) ||
						projGrants.has(p.id) ||
						projDeps.some((d) => d.dependsOnId === p.id)
				);

	// Per-view edit rights (project grant covers all views); hidden views are never rendered
	const editableViews: Record<string, boolean> = {};
	for (const v of views.filter((v) => !v.hidden)) {
		editableViews[v.id] = canEditProj || (await canEditView(locals.user, v.id));
	}

	return {
		project: proj,
		tasks,
		users,
		views,
		statuses: eligibleStatuses,
		projectStatuses: await projectStatusOptions(proj.workspaceId),
		milestones,
		locations,
		labels,
		labelGroups,
		projectLabelIds: projLabels.map((l) => l.labelId),
		taskLabels: tLabels,
		projectDependsOn: projDeps.map((d) => d.dependsOnId),
		allProjects: visibleProjects,
		taskDeps,
		milestoneDeps,
		customFields,
		customFieldOptions,
		taskCustomValues,
		files,
		savedFilters,
		templates,
		perm: { admin, project: canEditProj, views: editableViews }
	};
};

export const actions: Actions = {
	/* ------------------------------ tasks ------------------------------ */

	createTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canAccessProject(locals.user, params.id)))
			return fail(403, { message: 'No access to this project' });

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
		defaultStatus ??= eligible.find((s) => s.category === 'backlog') ?? eligible[0];
		if (!defaultStatus) return fail(400, { message: 'Project has no eligible statuses' });

		// optional prefilled fields (new-task pane: milestone / assignee / due date)
		const assigneeId = String(form.get('assigneeId') ?? '') || null;
		if (assigneeId) {
			const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, assigneeId));
			if (!u) return fail(400, { message: 'Unknown assignee' });
		}
		const milestoneId = String(form.get('milestoneId') ?? '') || null;
		if (milestoneId) {
			const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
			if (!m || m.projectId !== params.id)
				return fail(400, { message: 'Milestone must belong to this project' });
		}
		const dueRaw = String(form.get('dueDate') ?? '');
		const dueDate = dueRaw ? new Date(dueRaw + 'T00:00:00') : null;

		const now = new Date();
		const taskId = crypto.randomUUID();
		await db.insert(task).values({
			id: taskId,
			projectId: params.id,
			parentId,
			title,
			priority,
			statusId: defaultStatus.id,
			assigneeId,
			milestoneId,
			dueDate,
			createdBy: locals.user.id,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});

		const cfRes = await writeTaskCustomValues(taskId, params.id, cfEntries(form));
		if (cfRes.error) {
			await db.delete(task).where(eq(task.id, taskId));
			return fail(400, { message: cfRes.error });
		}

		// optional label prefill (label-grouped quick-add); silently skip an invalid one
		const labelId = String(form.get('labelId') ?? '') || null;
		if (labelId) {
			const [l] = await db.select().from(label).where(eq(label.id, labelId));
			const [proj0] = await db.select({ workspaceId: project.workspaceId }).from(project).where(eq(project.id, params.id));
			if (l && proj0 && l.workspaceId === proj0.workspaceId)
				await db.insert(taskLabel).values({ taskId, labelId }).onConflictDoNothing();
		}

		const [proj] = await db.select().from(project).where(eq(project.id, params.id));
		void dispatchEvent({
			type: 'task.created',
			actor: locals.user.name,
			projectName: proj?.name ?? 'Unknown project',
			taskTitle: title
		});

		void logActivity(params.id, taskId, locals.user.id, 'created', { title });

		broadcastProjectChange(params.id, locals.user.id);
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

		void logActivity(params.id, id, locals.user.id, 'status', { to: statusId });

		// Recurring task: when it moves into a completed status, spawn the next
		// occurrence with its due date advanced by the recurrence rule (BASDEV-8).
		const wasCompleted = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
		if (target.category === 'completed' && !wasCompleted && existing.recurrence) {
			const nextDue = nextDueDate(existing.dueDate ?? new Date(), existing.recurrence);
			const backlog = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
			if (backlog) {
				const spawnNow = new Date();
				await db.insert(task).values({
					id: crypto.randomUUID(),
					projectId: existing.projectId,
					parentId: existing.parentId,
					title: existing.title,
					description: existing.description,
					priority: existing.priority,
					statusId: backlog.id,
					assigneeId: existing.assigneeId,
					milestoneId: existing.milestoneId,
					locationId: existing.locationId,
					startDate: existing.startDate,
					dueDate: nextDue,
					recurrence: existing.recurrence,
					createdBy: locals.user.id,
					position: spawnNow.getTime(),
					createdAt: spawnNow,
					updatedAt: spawnNow
				});
			}
		}

		// Completing a parent completes its sub-tasks
		if (target.category === 'completed') {
			await db
				.update(task)
				.set({ statusId, updatedAt: new Date() })
				.where(eq(task.parentId, id));
		}

		const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
		if (target.category === 'completed' && !wasDone) {
			const [proj] = await db.select().from(project).where(eq(project.id, existing.projectId));
			void dispatchEvent({
				type: 'task.completed',
				actor: locals.user.name,
				projectName: proj?.name ?? 'Unknown project',
				taskTitle: existing.title
			});
		}

		broadcastProjectChange(params.id, locals.user.id);
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

		const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
		if (target.category === 'completed') {
			await db
				.update(task)
				.set({ statusId, updatedAt: new Date() })
				.where(eq(task.parentId, id));
		}
		if (target.category === 'completed' && !wasDone) {
			const [proj] = await db.select().from(project).where(eq(project.id, params.id));
			void dispatchEvent({
				type: 'task.completed',
				actor: locals.user.name,
				projectName: proj?.name ?? 'Unknown project',
				taskTitle: existing.title
			});
		}

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/** Patch only the task fields present in the form (the task-pane pills + title/desc). */
	patchTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const existing = await getTask(id);
		if (!existing || existing.projectId !== params.id)
			return fail(400, { message: 'Invalid task' });
		if (!(await canEditTask(locals.user, existing)))
			return fail(403, { message: 'No edit permission on this task' });

		const set: Partial<typeof task.$inferInsert> = {};

		if (form.has('title')) {
			const title = String(form.get('title') ?? '').trim();
			if (!title) return fail(400, { message: 'Task title is required' });
			if (title.length > 240) return fail(400, { message: 'Title too long (max 240)' });
			set.title = title;
		}
		if (form.has('description')) {
			set.description = String(form.get('description') ?? '').trim() || null;
		}
		if (form.has('priority')) {
			const priority = String(form.get('priority') ?? 'none');
			if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number]))
				return fail(400, { message: 'Invalid priority' });
			set.priority = priority;
		}
		if (form.has('assigneeId')) {
			const assigneeId = String(form.get('assigneeId') ?? '') || null;
			if (assigneeId) {
				const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, assigneeId));
				if (!u) return fail(400, { message: 'Unknown assignee' });
			}
			set.assigneeId = assigneeId;
		}
		if (form.has('milestoneId')) {
			const milestoneId = String(form.get('milestoneId') ?? '') || null;
			if (milestoneId) {
				const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
				if (!m || m.projectId !== params.id)
					return fail(400, { message: 'Milestone must belong to this project' });
			}
			set.milestoneId = milestoneId;
		}
		if (form.has('locationId')) {
			const locationId = String(form.get('locationId') ?? '') || null;
			if (locationId) {
				const [l] = await db.select().from(location).where(eq(location.id, locationId));
				if (!l || l.projectId !== params.id)
					return fail(400, { message: 'Location must belong to this project' });
			}
			set.locationId = locationId;
		}
		if (form.has('order')) {
			const raw = String(form.get('order') ?? '').trim();
			if (raw === '') set.order = null;
			else {
				const order = Number(raw);
				if (!Number.isInteger(order)) return fail(400, { message: 'Order must be a whole number' });
				set.order = order;
			}
		}
		if (form.has('dueDate')) {
			const raw = String(form.get('dueDate') ?? '');
			set.dueDate = raw ? new Date(raw + 'T00:00:00') : null;
		}
		if (form.has('recurrence')) {
			const raw = String(form.get('recurrence') ?? '').trim();
			if (raw === '') set.recurrence = null;
			else if (!isValidRecurrence(raw)) return fail(400, { message: 'Invalid recurrence rule' });
			else set.recurrence = raw;
		}
		// re-parent: nest this task under another (make it a sub-task). Depth-1 only.
		if (form.has('parentId')) {
			const parentId = String(form.get('parentId') ?? '') || null;
			if (parentId) {
				if (parentId === id) return fail(400, { message: 'A task cannot be its own parent' });
				const parent = await getTask(parentId);
				if (!parent || parent.projectId !== params.id)
					return fail(400, { message: 'Parent must belong to this project' });
				if (parent.parentId) return fail(400, { message: 'Sub-tasks cannot have sub-tasks' });
				const [{ n }] = await db
					.select({ n: count(task.id) })
					.from(task)
					.where(eq(task.parentId, id));
				if (n > 0) return fail(400, { message: 'Move or remove this task’s sub-tasks first' });
			}
			set.parentId = parentId;
		}

		const cf = cfEntries(form);
		if (Object.keys(set).length === 0 && cf.length === 0)
			return fail(400, { message: 'No fields to update' });

		await db
			.update(task)
			.set({ ...set, updatedAt: new Date() })
			.where(eq(task.id, id));
		if (cf.length > 0) {
			const res = await writeTaskCustomValues(id, params.id, cf);
			if (res.error) return fail(400, { message: res.error });
		}

		if (set.title !== undefined && set.title !== existing.title)
			void logActivity(params.id, id, locals.user.id, 'title', { from: existing.title, to: set.title });
		if (set.statusId !== undefined && set.statusId !== existing.statusId)
			void logActivity(params.id, id, locals.user.id, 'status', { to: set.statusId });
		if (set.assigneeId !== undefined && set.assigneeId !== existing.assigneeId)
			void logActivity(params.id, id, locals.user.id, 'assignee', { to: set.assigneeId });
		if (set.milestoneId !== undefined && set.milestoneId !== existing.milestoneId)
			void logActivity(params.id, id, locals.user.id, 'milestone', { to: set.milestoneId });
		if (set.priority !== undefined && set.priority !== existing.priority)
			void logActivity(params.id, id, locals.user.id, 'priority', { to: set.priority });
		if (set.dueDate !== undefined)
			void logActivity(params.id, id, locals.user.id, 'due', {
				to: set.dueDate ? new Date(set.dueDate).toISOString().slice(0, 10) : null
			});

		broadcastProjectChange(params.id, locals.user.id);
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
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/* ------------------------- comments (BASDEV-3) ------------------------- */

	addComment: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canAccessProject(locals.user, params.id)))
			return fail(404, { message: 'Not found' });

		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		const body = String(form.get('body') ?? '').trim();

		const existing = await getTask(taskId);
		if (!existing || existing.projectId !== params.id)
			return fail(400, { message: 'Invalid task' });
		if (!body) return fail(400, { message: 'Comment cannot be empty' });
		if (body.length > 10000) return fail(400, { message: 'Comment too long (max 10000)' });

		await createComment(taskId, locals.user.id, body);
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	editComment: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const commentId = String(form.get('commentId') ?? '');
		const body = String(form.get('body') ?? '').trim();

		const existing = await getComment(commentId);
		if (!existing) return fail(404, { message: 'Comment not found' });
		const target = await getTask(existing.taskId);
		if (!target || target.projectId !== params.id)
			return fail(404, { message: 'Comment not found' });
		if (existing.authorId !== locals.user.id && !isAdmin(locals.user))
			return fail(403, { message: 'Not your comment' });
		if (!body) return fail(400, { message: 'Comment cannot be empty' });
		if (body.length > 10000) return fail(400, { message: 'Comment too long (max 10000)' });

		await updateComment(commentId, body);
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteComment: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const commentId = String(form.get('commentId') ?? '');

		const existing = await getComment(commentId);
		if (!existing) return fail(404, { message: 'Comment not found' });
		const target = await getTask(existing.taskId);
		if (!target || target.projectId !== params.id)
			return fail(404, { message: 'Comment not found' });
		if (existing.authorId !== locals.user.id && !isAdmin(locals.user))
			return fail(403, { message: 'Not your comment' });

		await deleteComment(commentId);
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/* ---------------------------- bulk actions (BASDEV-6) ---------------------------- */

	bulkPatchTasks: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const ids = [...new Set(form.getAll('ids').map(String).filter(Boolean))];
		if (ids.length === 0) return fail(400, { message: 'No tasks selected' });

		const set: Partial<typeof task.$inferInsert> = {};
		// Track whether the new status completes tasks, to cascade to sub-tasks (mirrors single setStatus).
		let completedStatusId: string | null = null;

		if (form.has('statusId')) {
			const statusId = String(form.get('statusId') ?? '');
			if (!statusId) return fail(400, { message: 'Invalid status' });
			const eligible = await listProjectStatuses(params.id);
			const target = eligible.find((s) => s.id === statusId);
			if (!target) return fail(400, { message: 'Status not eligible for this project' });
			set.statusId = statusId;
			if (target.category === 'completed') completedStatusId = statusId;
		}
		if (form.has('assigneeId')) {
			const assigneeId = String(form.get('assigneeId') ?? '') || null;
			if (assigneeId) {
				const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, assigneeId));
				if (!u) return fail(400, { message: 'Unknown assignee' });
			}
			set.assigneeId = assigneeId;
		}
		if (form.has('milestoneId')) {
			const milestoneId = String(form.get('milestoneId') ?? '') || null;
			if (milestoneId) {
				const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
				if (!m || m.projectId !== params.id)
					return fail(400, { message: 'Milestone must belong to this project' });
			}
			set.milestoneId = milestoneId;
		}
		if (form.has('priority')) {
			const priority = String(form.get('priority') ?? 'none');
			if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number]))
				return fail(400, { message: 'Invalid priority' });
			set.priority = priority;
		}
		// Move: re-parent selected tasks under another top-level task ('' = promote to top-level)
		if (form.has('parentId')) {
			const parentId = String(form.get('parentId') ?? '') || null;
			if (parentId) {
				if (ids.includes(parentId))
					return fail(400, { message: 'A task cannot be moved under itself' });
				const [p] = await db.select().from(task).where(eq(task.id, parentId));
				if (!p || p.projectId !== params.id)
					return fail(400, { message: 'Parent must belong to this project' });
				if (p.parentId) return fail(400, { message: 'Parent must be a top-level task' });
			}
			set.parentId = parentId;
		}

		if (Object.keys(set).length === 0) return fail(400, { message: 'No fields to update' });

		const rows = await db.select().from(task).where(inArray(task.id, ids));
		const allowed: string[] = [];
		for (const t of rows) {
			if (t.projectId !== params.id) continue;
			if (await canEditTask(locals.user, t)) allowed.push(t.id);
		}
		if (allowed.length === 0) return fail(403, { message: 'No editable tasks selected' });

		// re-parenting only applies to childless tasks (one nesting level)
		if (set.parentId !== undefined && set.parentId !== null) {
			const kids = await db
				.select({ parentId: task.parentId })
				.from(task)
				.where(inArray(task.parentId, allowed));
			if (kids.length) return fail(400, { message: 'Cannot move a task that has sub-tasks' });
		}

		await db
			.update(task)
			.set({ ...set, updatedAt: new Date() })
			.where(inArray(task.id, allowed));

		// Completing a task completes its sub-tasks (mirrors single setStatus cascade).
		if (completedStatusId)
			await db
				.update(task)
				.set({ statusId: completedStatusId, updatedAt: new Date() })
				.where(inArray(task.parentId, allowed));

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true, updated: allowed.length };
	},

	/** Creates a new top-level task and re-parents the selected tasks under it (Move → create). */
	bulkReparentToNew: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canAccessProject(locals.user, params.id)))
			return fail(403, { message: 'No access to this project' });

		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const ids = [...new Set(form.getAll('ids').map(String).filter(Boolean))];
		if (!title) return fail(400, { message: 'Task title is required' });
		if (title.length > 240) return fail(400, { message: 'Title too long (max 240)' });
		if (ids.length === 0) return fail(400, { message: 'No tasks selected' });

		const eligible = await listProjectStatuses(params.id);
		const defaultStatus = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
		if (!defaultStatus) return fail(400, { message: 'Project has no eligible statuses' });

		const rows = await db.select().from(task).where(inArray(task.id, ids));
		const allowed: string[] = [];
		for (const t of rows) {
			if (t.projectId !== params.id) continue;
			if (await canEditTask(locals.user, t)) allowed.push(t.id);
		}
		if (allowed.length === 0) return fail(403, { message: 'No editable tasks selected' });
		const kids = await db.select({ id: task.id }).from(task).where(inArray(task.parentId, allowed));
		if (kids.length) return fail(400, { message: 'Cannot move a task that has sub-tasks' });

		const now = new Date();
		const newId = crypto.randomUUID();
		await db.insert(task).values({
			id: newId,
			projectId: params.id,
			parentId: null,
			title,
			priority: 'none',
			statusId: defaultStatus.id,
			createdBy: locals.user.id,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});
		await db.update(task).set({ parentId: newId, updatedAt: now }).where(inArray(task.id, allowed));

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true, parentId: newId, moved: allowed.length };
	},

	bulkDeleteTasks: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const ids = [...new Set(form.getAll('ids').map(String).filter(Boolean))];
		if (ids.length === 0) return fail(400, { message: 'No tasks selected' });

		const rows = await db.select().from(task).where(inArray(task.id, ids));
		const allowed: string[] = [];
		for (const t of rows) {
			if (t.projectId !== params.id) continue;
			if (await canEditTask(locals.user, t)) allowed.push(t.id);
		}
		if (allowed.length === 0) return fail(403, { message: 'No deletable tasks selected' });

		await db.delete(task).where(inArray(task.parentId, allowed)); // sub-tasks first
		await db.delete(task).where(inArray(task.id, allowed));

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true, deleted: allowed.length };
	},

	/* -------------------------- saved filters (BASDEV-7) -------------------------- */

	createSavedFilter: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const configRaw = String(form.get('config') ?? '{}');

		if (!name) return fail(400, { message: 'Filter name is required' });
		if (name.length > 120) return fail(400, { message: 'Filter name too long (max 120)' });

		let config: unknown;
		try {
			config = JSON.parse(configRaw);
		} catch {
			return fail(400, { message: 'Invalid filter config' });
		}
		if (!config || typeof config !== 'object' || Array.isArray(config))
			return fail(400, { message: 'Invalid filter config' });

		try {
			await createSavedFilter({
				projectId: params.id,
				name,
				config: config as Record<string, unknown>,
				createdBy: locals.user.id
			});
		} catch (e) {
			return fail(400, { message: e instanceof Error ? e.message : 'Could not save filter' });
		}

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteSavedFilter: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const ok = await deleteSavedFilter(id, params.id);
		if (!ok) return fail(400, { message: 'Invalid saved filter' });

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/* ------------------------ templates + recurring (BASDEV-8) ------------------------ */

	saveTaskAsTemplate: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		const templateId = String(form.get('templateId') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const scope = String(form.get('scope') ?? 'project') === 'workspace' ? 'workspace' : 'project';

		const parent = await getTask(taskId);
		if (!parent || parent.projectId !== params.id)
			return fail(400, { message: 'Invalid task' });

		const [proj] = await db
			.select({ workspaceId: project.workspaceId })
			.from(project)
			.where(eq(project.id, params.id));

		// Capture the task tree (parent + sub-tasks + their custom-field values).
		const subtasks = await db.select().from(task).where(eq(task.parentId, taskId));
		const ids = [parent.id, ...subtasks.map((s) => s.id)];
		const cfValues = ids.length
			? await db
					.select({
						taskId: taskCustomValue.taskId,
						fieldId: taskCustomValue.fieldId,
						value: taskCustomValue.value
					})
					.from(taskCustomValue)
					.where(inArray(taskCustomValue.taskId, ids))
			: [];
		const payload = buildPayloadFromTask(parent, subtasks, cfValues);

		// Update path: overwrite an existing (in-scope) template's contents.
		if (templateId) {
			const tpl = await getTemplate(templateId);
			if (!tpl) return fail(400, { message: 'Unknown template' });
			// Editing a workspace-scoped template is workspace structure.
			if (tpl.scope === 'workspace') {
				if (!tpl.workspaceId || !(await canEditWorkspace(locals.user, tpl.workspaceId)))
					return fail(403, { message: 'No edit permission on this workspace' });
			}
			const updated = await updateTemplatePayload(templateId, params.id, payload);
			if (!updated) return fail(400, { message: 'Template not in this project' });
			broadcastProjectChange(params.id, locals.user.id);
			return { success: true };
		}

		// Create path: a new template needs a name.
		if (!name) return fail(400, { message: 'Template name is required' });
		if (name.length > 120) return fail(400, { message: 'Name too long (max 120)' });
		// Workspace-scoped templates are workspace structure — require workspace edit rights.
		if (scope === 'workspace') {
			if (!proj?.workspaceId || !(await canEditWorkspace(locals.user, proj.workspaceId)))
				return fail(403, { message: 'No edit permission on this workspace' });
		}
		await createTemplate({
			name,
			scope,
			projectId: params.id,
			workspaceId: proj?.workspaceId ?? null,
			payload,
			createdBy: locals.user.id
		});
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	createFromTemplate: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canAccessProject(locals.user, params.id)))
			return fail(403, { message: 'No access to this project' });

		const form = await request.formData();
		const templateId = String(form.get('templateId') ?? '');
		if (!templateId) return fail(400, { message: 'templateId is required' });

		let newId: string | null;
		try {
			newId = await instantiateTemplate(templateId, params.id, locals.user.id);
		} catch (err) {
			console.error('[templates] instantiate failed:', err);
			return fail(400, { message: 'Template could not be instantiated' });
		}
		if (!newId) return fail(400, { message: 'Template could not be instantiated' });
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteTemplate: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canAccessProject(locals.user, params.id)))
			return fail(403, { message: 'No access to this project' });

		const form = await request.formData();
		const templateId = String(form.get('templateId') ?? '');
		if (!templateId) return fail(400, { message: 'templateId is required' });

		const [tpl] = await db.select().from(template).where(eq(template.id, templateId));
		if (!tpl) return fail(400, { message: 'Unknown template' });
		const [proj] = await db
			.select({ workspaceId: project.workspaceId })
			.from(project)
			.where(eq(project.id, params.id));
		const owned =
			tpl.projectId === params.id ||
			(!!tpl.workspaceId && !!proj?.workspaceId && tpl.workspaceId === proj.workspaceId);
		if (!owned) return fail(403, { message: 'Cannot delete this template' });

		await deleteTemplate(templateId);
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/* ------------------------- task cover image (BASDEV-12) ------------------------- */

	setTaskCover: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const coverFileId = String(form.get('coverFileId') ?? '') || null;

		const existing = await getTask(id);
		if (!existing || existing.projectId !== params.id)
			return fail(400, { message: 'Invalid task' });
		if (!(await canEditTask(locals.user, existing)))
			return fail(403, { message: 'No edit permission on this task' });

		if (coverFileId) {
			const [f] = await db.select().from(file).where(eq(file.id, coverFileId));
			if (!f || f.taskId !== id || f.projectId !== params.id)
				return fail(400, { message: 'Cover must be a file attached to this task' });
			if (!f.mimeType.startsWith('image/'))
				return fail(400, { message: 'Cover must be an image' });
		}

		await db
			.update(task)
			.set({ coverFileId, updatedAt: new Date() })
			.where(eq(task.id, id));
		broadcastProjectChange(params.id, locals.user.id);
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
			const [proj] = await db.select().from(project).where(eq(project.id, params.id));
			if (!l || !proj || l.workspaceId !== proj.workspaceId)
				return fail(400, { message: 'Unknown label' });
			await db.insert(taskLabel).values({ taskId, labelId });
		}
		broadcastProjectChange(params.id, locals.user.id);
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
		broadcastProjectChange(params.id, locals.user.id);
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
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/* ------------------------------ views ------------------------------ */

	/** Adds a view of the given type (multiple views per type allowed, ADR-020). */
	createView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const type = String(form.get('type') ?? '');

		if (!VIEW_TYPES.includes(type as ViewType)) return fail(400, { message: 'Invalid view type' });

		const existing = await db
			.select({ name: view.name })
			.from(view)
			.where(eq(view.projectId, params.id));
		const base = type[0].toUpperCase() + type.slice(1);
		let name = base;
		for (let n = 2; existing.some((v) => v.name === name); n++) name = `${base} ${n}`;

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

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true, viewId: id };
	},

	/** Re-enables a hidden view, keeping its config. */
	unhideView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const [v] = await db.select().from(view).where(eq(view.id, id));
		if (!v || v.projectId !== params.id) return fail(400, { message: 'Invalid view' });
		if (!(await canEditView(locals.user, id)))
			return fail(403, { message: 'No edit permission on this view' });

		await db.update(view).set({ hidden: false, updatedAt: new Date() }).where(eq(view.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true, viewId: id };
	},

	duplicateView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const [v] = await db.select().from(view).where(eq(view.id, id));
		if (!v || v.projectId !== params.id) return fail(400, { message: 'Invalid view' });

		const existing = await db
			.select({ name: view.name })
			.from(view)
			.where(eq(view.projectId, params.id));
		let name = `${v.name} copy`;
		for (let n = 2; existing.some((x) => x.name === name); n++) name = `${v.name} copy ${n}`;

		const now = new Date();
		const newId = crypto.randomUUID();
		await db.insert(view).values({
			id: newId,
			projectId: params.id,
			name,
			type: v.type,
			config: v.config,
			position: v.position + 1,
			createdBy: locals.user.id,
			createdAt: now,
			updatedAt: now
		});

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true, viewId: newId };
	},

	deleteView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const [v] = await db.select().from(view).where(eq(view.id, id));
		if (!v || v.projectId !== params.id) return fail(400, { message: 'Invalid view' });
		if (!(await canEditView(locals.user, id)))
			return fail(403, { message: 'No edit permission on this view' });

		const visible = await db
			.select({ id: view.id })
			.from(view)
			.where(and(eq(view.projectId, params.id), eq(view.hidden, false)));
		if (!v.hidden && visible.length <= 1)
			return fail(400, { message: 'A project must keep at least one view' });

		await db.delete(view).where(eq(view.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/** Updates a view's name and/or config (config untouched when not posted). */
	updateView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const name = String(form.get('name') ?? '').trim();
		const configRaw = form.get('config');

		const [v] = await db.select().from(view).where(eq(view.id, id));
		if (!v || v.projectId !== params.id) return fail(400, { message: 'Invalid view' });
		if (!(await canEditView(locals.user, id)))
			return fail(403, { message: 'No edit permission on this view' });

		if (!name) return fail(400, { message: 'View name is required' });

		let config: string | undefined;
		if (configRaw !== null) {
			try {
				const parsed = JSON.parse(String(configRaw));
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
					config = JSON.stringify(parsed);
				else return fail(400, { message: 'Invalid view config' });
			} catch {
				return fail(400, { message: 'Invalid view config' });
			}
		}

		// type is fixed at creation
		await db
			.update(view)
			.set({ name, ...(config !== undefined ? { config } : {}), updatedAt: new Date() })
			.where(eq(view.id, id));

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/** Reorders the project's views (drag-and-drop tabs). Body: `ids` = comma-separated view ids. */
	reorderView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const ids = String((await request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		const rows = await db.select({ id: view.id }).from(view).where(eq(view.projectId, params.id));
		const projectIds = new Set(rows.map((r) => r.id));
		// the posted set must reference only this project's views
		if (!ids.length || !ids.every((id) => projectIds.has(id)))
			return fail(400, { message: 'Invalid order' });
		if (!(await canEditView(locals.user, ids[0])))
			return fail(403, { message: 'No edit permission on this view' });

		for (let i = 0; i < ids.length; i++)
			await db.update(view).set({ position: i * 10 }).where(eq(view.id, ids[i]));

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/* ------------------------- project "…" menu ------------------------- */

	pinProject: async ({ params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const [proj] = await db.select().from(project).where(eq(project.id, params.id));
		if (!proj) return fail(404, { message: 'Project not found' });

		await db
			.update(project)
			.set({ pinned: !proj.pinned, updatedAt: new Date() })
			.where(eq(project.id, params.id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	setProjectIcon: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const raw = String(form.get('icon') ?? '').trim();
		let icon: string | null;
		if (raw.startsWith('iconoir:')) {
			if (!ICONOIR_NAMES.includes(raw.slice(8))) return fail(400, { message: 'Unknown icon' });
			icon = raw;
		} else {
			icon = raw.slice(0, 8) || null; // emoji or legacy glyph
		}

		await db
			.update(project)
			.set({ icon, updatedAt: new Date() })
			.where(eq(project.id, params.id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	setProjectStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const statusId = String(form.get('statusId') ?? '') || null;

		const [proj] = await db.select().from(project).where(eq(project.id, params.id));
		if (!proj) return fail(404, { message: 'Project not found' });

		if (statusId) {
			const options = await projectStatusOptions(proj.workspaceId);
			if (!options.some((s) => s.id === statusId))
				return fail(400, { message: 'Status not available to this project' });
		}

		await db
			.update(project)
			.set({ statusId, updatedAt: new Date() })
			.where(eq(project.id, params.id));
		broadcastProjectChange(params.id, locals.user.id);
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
			const [proj] = await db.select().from(project).where(eq(project.id, params.id));
			if (!l || !proj || l.workspaceId !== proj.workspaceId)
				return fail(400, { message: 'Unknown label' });
			await db.insert(projectLabel).values({ projectId: params.id, labelId });
		}
		broadcastProjectChange(params.id, locals.user.id);
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
		const msId = crypto.randomUUID();
		await db.insert(milestone).values({
			id: msId,
			projectId: params.id,
			name,
			targetDate: targetDateRaw ? new Date(targetDateRaw + 'T00:00:00') : null,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});

		// optionally assign the new milestone to a task in one step (task-pane create)
		const assignTaskId = String(form.get('taskId') ?? '') || null;
		if (assignTaskId) {
			const t = await getTask(assignTaskId);
			if (t && t.projectId === params.id && (await canEditTask(locals.user, t)))
				await db.update(task).set({ milestoneId: msId, updatedAt: now }).where(eq(task.id, assignTaskId));
		}

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true, milestoneId: msId };
	},

	/* ----------------------------- locations ----------------------------- */

	createLocation: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const address = String(form.get('address') ?? '').trim() || null;
		const assignTaskId = String(form.get('taskId') ?? '') || null;

		if (!title) return fail(400, { message: 'Location title is required' });
		const coords = parseCoords(form);
		if ('error' in coords) return fail(400, { message: coords.error });
		const { lat, lng } = coords;

		const now = new Date();
		const locId = crypto.randomUUID();
		await db.insert(location).values({
			id: locId,
			projectId: params.id,
			title,
			address,
			latitude: lat,
			longitude: lng,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});

		if (assignTaskId) {
			const t = await getTask(assignTaskId);
			if (t && t.projectId === params.id && (await canEditTask(locals.user, t)))
				await db
					.update(task)
					.set({ locationId: locId, updatedAt: now })
					.where(eq(task.id, assignTaskId));
		}

		broadcastProjectChange(params.id, locals.user.id);
		return { success: true, locationId: locId };
	},

	updateLocation: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const address = String(form.get('address') ?? '').trim() || null;

		const [loc] = await db.select().from(location).where(eq(location.id, id));
		if (!loc || loc.projectId !== params.id) return fail(400, { message: 'Invalid location' });
		if (!title) return fail(400, { message: 'Location title is required' });
		const coords = parseCoords(form);
		if ('error' in coords) return fail(400, { message: coords.error });

		await db
			.update(location)
			.set({ title, address, latitude: coords.lat, longitude: coords.lng, updatedAt: new Date() })
			.where(eq(location.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteLocation: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(location).where(and(eq(location.id, id), eq(location.projectId, params.id)));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	updateMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const [ms] = await db.select().from(milestone).where(eq(milestone.id, id));
		if (!ms || ms.projectId !== params.id) return fail(400, { message: 'Invalid milestone' });

		const patch: { name?: string; targetDate?: Date | null } = {};
		if (form.has('name')) {
			const name = String(form.get('name') ?? '').trim();
			if (!name) return fail(400, { message: 'Milestone name is required' });
			patch.name = name;
		}
		if (form.has('targetDate')) {
			const raw = String(form.get('targetDate') ?? '').trim();
			patch.targetDate = raw ? new Date(raw + 'T00:00:00') : null;
		}
		if (!('name' in patch) && !('targetDate' in patch))
			return fail(400, { message: 'No fields to update' });

		await db.update(milestone).set({ ...patch, updatedAt: new Date() }).where(eq(milestone.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(milestone).where(and(eq(milestone.id, id), eq(milestone.projectId, params.id)));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	addMilestoneDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const milestoneId = String(form.get('milestoneId') ?? '');
		const dependsOnId = String(form.get('dependsOnId') ?? '');

		if (milestoneId === dependsOnId)
			return fail(400, { message: 'A milestone cannot depend on itself' });

		const [m, dep] = await Promise.all([
			db.select().from(milestone).where(eq(milestone.id, milestoneId)),
			db.select().from(milestone).where(eq(milestone.id, dependsOnId))
		]);
		if (!m[0] || !dep[0] || m[0].projectId !== params.id || dep[0].projectId !== params.id)
			return fail(400, { message: 'Both milestones must belong to this project' });

		const all = await db
			.select({ milestoneId: milestoneDependency.milestoneId, dependsOnId: milestoneDependency.dependsOnId })
			.from(milestoneDependency)
			.innerJoin(milestone, eq(milestoneDependency.milestoneId, milestone.id))
			.where(eq(milestone.projectId, params.id));
		const edges = new Map<string, string[]>();
		for (const e of all) edges.set(e.milestoneId, [...(edges.get(e.milestoneId) ?? []), e.dependsOnId]);
		if (createsCycle(edges, milestoneId, dependsOnId))
			return fail(400, { message: 'That dependency would create a cycle' });

		await db
			.insert(milestoneDependency)
			.values({ milestoneId, dependsOnId })
			.onConflictDoNothing();
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/** Replaces a milestone's full dependency set. Body: `milestoneId` + repeated `dependsOnId`. */
	setMilestoneDeps: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const milestoneId = String(form.get('milestoneId') ?? '');
		const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
		if (!m || m.projectId !== params.id) return fail(400, { message: 'Invalid milestone' });

		const projectMs = await db
			.select({ id: milestone.id })
			.from(milestone)
			.where(eq(milestone.projectId, params.id));
		const validIds = new Set(projectMs.map((r) => r.id));
		const desired = [...new Set(form.getAll('dependsOnId').map(String))].filter(
			(id) => id && id !== milestoneId && validIds.has(id)
		);

		// edges minus this milestone's current deps; re-add desired one by one, skipping cycles
		const all = await db
			.select({ milestoneId: milestoneDependency.milestoneId, dependsOnId: milestoneDependency.dependsOnId })
			.from(milestoneDependency)
			.innerJoin(milestone, eq(milestoneDependency.milestoneId, milestone.id))
			.where(eq(milestone.projectId, params.id));
		const edges = new Map<string, string[]>();
		for (const e of all)
			if (e.milestoneId !== milestoneId)
				edges.set(e.milestoneId, [...(edges.get(e.milestoneId) ?? []), e.dependsOnId]);

		const accepted: string[] = [];
		for (const dep of desired) {
			if (createsCycle(edges, milestoneId, dep)) continue;
			accepted.push(dep);
			edges.set(milestoneId, [...(edges.get(milestoneId) ?? []), dep]);
		}

		await db.delete(milestoneDependency).where(eq(milestoneDependency.milestoneId, milestoneId));
		if (accepted.length)
			await db
				.insert(milestoneDependency)
				.values(accepted.map((dependsOnId) => ({ milestoneId, dependsOnId })))
				.onConflictDoNothing();
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	removeMilestoneDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const milestoneId = String(form.get('milestoneId') ?? '');
		const dependsOnId = String(form.get('dependsOnId') ?? '');
		await db
			.delete(milestoneDependency)
			.where(
				and(
					eq(milestoneDependency.milestoneId, milestoneId),
					eq(milestoneDependency.dependsOnId, dependsOnId)
				)
			);
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteProject: async ({ params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });
		await db.delete(project).where(eq(project.id, params.id));
		broadcastProjectChange(params.id, locals.user.id);
		redirect(303, '/projects');
	},

	/** Hides a view (config kept; the "+" menu re-enables it). */
	hideView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const [v] = await db.select().from(view).where(eq(view.id, id));
		if (!v || v.projectId !== params.id) return fail(400, { message: 'Invalid view' });
		if (!(await canEditView(locals.user, id)))
			return fail(403, { message: 'No edit permission on this view' });

		const visible = await db
			.select({ id: view.id })
			.from(view)
			.where(and(eq(view.projectId, params.id), eq(view.hidden, false)));
		if (visible.length <= 1)
			return fail(400, { message: 'A project must keep at least one view' });

		await db.update(view).set({ hidden: true, updatedAt: new Date() }).where(eq(view.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	}
};
