import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
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
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { deleteFilesForProject } from '$lib/server/uploads';
import { notifyMentions } from '$lib/server/mentions';
import {
	createComment,
	updateComment,
	deleteComment,
	getComment
} from '$lib/server/comments';
import {
	listTemplatesForProject,
	createTemplate,
	updateTemplatePayload,
	getTemplate,
	deleteTemplate,
	instantiateTemplate,
	buildPayloadFromTask
} from '$lib/server/templates';
import {
	reorderMilestones,
	createMilestone as createMilestoneService,
	updateMilestoneById,
	deleteMilestoneById,
	addMilestoneDep as addMilestoneDepService,
	setMilestoneDeps as setMilestoneDepsService,
	removeMilestoneDep as removeMilestoneDepService
} from '$lib/server/milestones';
import {
	listCustomFieldOptions,
	listProjectCustomFields,
	listProjectCustomValues
} from '$lib/server/customFields';
import { collectVisibleUserIds, computeProjectRollupText } from '$lib/server/projectLoad';
import {
	accessibleWorkspaceIds,
	canAccessProject,
	canEditProject,
	canEditTask,
	canEditWorkspace,
	grantedProjectIds,
	isAdmin,
	projectAccessUserIds
} from '$lib/server/permissions';
import { listProjectStatuses, listStatuses, listWorkspaceStatuses } from '$lib/server/statuses';
import { ICON_NAMES } from '$lib/heroiconNames';
import { createsCycle } from '$lib/server/graph';
import {
	createView as createViewService,
	duplicateView as duplicateViewService,
	updateViewById,
	reorderViews,
	deleteViewById
} from '$lib/server/views';
import {
	createTaskService,
	setTaskStatusService,
	moveTaskService,
	updateTaskService,
	deleteTaskService,
	bulkUpdateTasks,
	bulkReparentToNew as bulkReparentToNewService,
	bulkDeleteTasks as bulkDeleteTasksService,
	bulkSetLabel as bulkSetLabelService,
	type UpdateTaskInput
} from '$lib/server/tasks';
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

	// Split custom fields: task-facing (entity!='project') feed the views; project-entity
	// fields + their values render as key-value pills in the project header chips row.
	const allCustomFields = await listProjectCustomFields(params.id);
	const customFields = allCustomFields.filter((f) => (f.entity ?? 'task') !== 'project');
	const projectFields = allCustomFields.filter((f) => (f.entity ?? 'task') === 'project');
	const [customFieldOptions, projectFieldOptions, projectCustomValues, taskCustomValues, files] =
		await Promise.all([
			listCustomFieldOptions(customFields.map((f) => f.id)),
			listCustomFieldOptions(projectFields.map((f) => f.id)),
			listProjectCustomValues(params.id),
			taskIds.length > 0
				? db.select().from(taskCustomValue).where(inArray(taskCustomValue.taskId, taskIds))
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

	// ADR-019: assignee pickers/groupings expose only users who can ACCESS this
	// project — plus any user already referenced (assignee or person custom field)
	// so existing values still resolve to a name. Don't leak the whole roster.
	const visibleUserIds = collectVisibleUserIds(
		await projectAccessUserIds(params.id, proj.workspaceId),
		tasks,
		customFields,
		taskCustomValues,
		projectFields,
		projectCustomValues
	);
	const visibleUsers = users.filter((u) => visibleUserIds.has(u.id));

	// Per-view edit rights (project grant covers all views); hidden views are never rendered
	const editableViews: Record<string, boolean> = {};
	const visibleViews = views.filter((v) => !v.hidden);
	if (canEditProj) {
		for (const v of visibleViews) editableViews[v.id] = true;
	} else if (!locals.user) {
		for (const v of visibleViews) editableViews[v.id] = false;
	} else {
		const grantedViewIds = new Set(
			(
				await db
					.select({ id: permission.resourceId })
					.from(permission)
					.where(
						and(
							eq(permission.userId, locals.user.id),
							eq(permission.resourceType, 'view'),
							inArray(
								permission.resourceId,
								visibleViews.map((v) => v.id)
							)
						)
					)
			).map((r) => r.id)
		);
		for (const v of visibleViews) editableViews[v.id] = grantedViewIds.has(v.id);
	}

	// Project-entity rollup chip values (computed, never stored — aggregate a target
	// number field over all the project's tasks). Mirrors the custom-fields page's
	// projectRollupText so rollup fields can render as header chips.
	const projRollups = projectFields.filter((f) => f.type === 'rollup');
	let projectRollupText: Record<string, string> = {};
	if (projRollups.length > 0) {
		const [rollupTasks, rollupValues] = await Promise.all([
			db.select({ id: task.id, parentId: task.parentId }).from(task).where(eq(task.projectId, params.id)),
			db
				.select({ taskId: taskCustomValue.taskId, fieldId: taskCustomValue.fieldId, value: taskCustomValue.value })
				.from(taskCustomValue)
				.innerJoin(task, eq(taskCustomValue.taskId, task.id))
				.where(eq(task.projectId, params.id))
		]);
		projectRollupText = computeProjectRollupText(
			projRollups,
			customFields,
			projectFields,
			rollupTasks,
			rollupValues
		);
	}

	return {
		project: proj,
		tasks,
		users: visibleUsers,
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
		projectFields,
		projectFieldOptions,
		projectCustomValues,
		projectRollupText,
		files,
		templates,
		perm: { admin, project: canEditProj, views: editableViews }
	};
};

export const actions: Actions = {
	/* ------------------------------ tasks ------------------------------ */

	createTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const dueRaw = String(form.get('dueDate') ?? '');
		const res = await createTaskService(
			{
				projectId: params.id,
				title: String(form.get('title') ?? ''),
				parentId: String(form.get('parentId') ?? '') || null,
				priority: String(form.get('priority') ?? 'none'),
				statusId: String(form.get('statusId') ?? '') || undefined,
				assigneeId: String(form.get('assigneeId') ?? '') || null,
				milestoneId: String(form.get('milestoneId') ?? '') || null,
				dueDate: dueRaw ? new Date(dueRaw + 'T00:00:00') : null,
				cf: cfEntries(form),
				labelId: String(form.get('labelId') ?? '') || null,
				logCreate: true
			},
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	setStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const res = await setTaskStatusService(
			String(form.get('id') ?? ''),
			params.id,
			String(form.get('statusId') ?? ''),
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/** Board drag-and-drop: move a task to a status column, ordered before `beforeId` (or end). */
	moveTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const res = await moveTaskService(
			String(form.get('id') ?? ''),
			params.id,
			String(form.get('statusId') ?? ''),
			String(form.get('beforeId') ?? '') || null,
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/** Patch only the task fields present in the form (the task-pane pills + title/desc). */
	patchTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const input: UpdateTaskInput = {};
		if (form.has('title')) input.title = String(form.get('title') ?? '');
		if (form.has('description')) input.description = String(form.get('description') ?? '');
		if (form.has('priority')) input.priority = String(form.get('priority') ?? 'none');
		if (form.has('assigneeId')) input.assigneeId = String(form.get('assigneeId') ?? '') || null;
		if (form.has('milestoneId')) input.milestoneId = String(form.get('milestoneId') ?? '') || null;
		if (form.has('locationId')) input.locationId = String(form.get('locationId') ?? '') || null;
		if (form.has('order')) {
			const raw = String(form.get('order') ?? '').trim();
			if (raw === '') input.order = null;
			else {
				const order = Number(raw);
				if (!Number.isInteger(order)) return fail(400, { message: 'Order must be a whole number' });
				input.order = order;
			}
		}
		if (form.has('startDate')) {
			const raw = String(form.get('startDate') ?? '');
			input.startDate = raw ? new Date(raw + 'T00:00:00') : null;
		}
		if (form.has('dueDate')) {
			const raw = String(form.get('dueDate') ?? '');
			input.dueDate = raw ? new Date(raw + 'T00:00:00') : null;
		}
		if (form.has('recurrence')) input.recurrence = String(form.get('recurrence') ?? '').trim() || null;
		if (form.has('parentId')) input.parentId = String(form.get('parentId') ?? '') || null;
		const cf = cfEntries(form);
		if (cf.length > 0) input.cf = cf;

		const res = await updateTaskService(id, params.id, input, locals.user, {
			has: (key) => key === 'cf' ? cf.length > 0 : key in input,
			logActivity: true,
			notifyMentionsOnDescription: true
		});
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	deleteTask: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const res = await deleteTaskService(String(form.get('id') ?? ''), params.id, locals.user);
		if (!res.ok) return fail(res.status, { message: res.message });
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
		void notifyMentions({
			text: body,
			actorId: locals.user.id,
			actorName: locals.user.name,
			projectId: params.id,
			taskId,
			contextLabel: `a comment on "${existing.title}"`
		});
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
		void notifyMentions({
			text: body,
			prevText: existing.body,
			actorId: locals.user.id,
			actorName: locals.user.name,
			projectId: params.id,
			taskId: existing.taskId,
			contextLabel: 'a comment'
		});
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
		const res = await bulkUpdateTasks(
			ids,
			params.id,
			{
				statusId: form.has('statusId') ? String(form.get('statusId') ?? '') : undefined,
				assigneeId: form.has('assigneeId') ? String(form.get('assigneeId') ?? '') || null : undefined,
				milestoneId: form.has('milestoneId')
					? String(form.get('milestoneId') ?? '') || null
					: undefined,
				priority: form.has('priority') ? String(form.get('priority') ?? 'none') : undefined,
				parentId: form.has('parentId') ? String(form.get('parentId') ?? '') || null : undefined,
				has: (key) => (key === 'statusName' ? false : form.has(key))
			},
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true, updated: res.data.updated };
	},

	/** Creates a new top-level task and re-parents the selected tasks under it (Move → create). */
	bulkReparentToNew: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const ids = [...new Set(form.getAll('ids').map(String).filter(Boolean))];
		const res = await bulkReparentToNewService(
			ids,
			params.id,
			String(form.get('title') ?? ''),
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true, parentId: res.data.parentId, moved: res.data.moved };
	},

	bulkDeleteTasks: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const ids = [...new Set(form.getAll('ids').map(String).filter(Boolean))];
		const res = await bulkDeleteTasksService(ids, params.id, locals.user);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true, deleted: res.data.deleted };
	},

	/** Bulk add/remove one label across the selected tasks (labels are multi-value, so
	 * this is a per-label toggle applied to the whole selection: `add=1` inserts it on
	 * all, otherwise removes it from all). Mirrors `toggleTaskLabel`'s validation. */
	bulkSetLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const ids = [...new Set(form.getAll('ids').map(String).filter(Boolean))];
		const res = await bulkSetLabelService(
			ids,
			params.id,
			String(form.get('labelId') ?? ''),
			String(form.get('add') ?? '') === '1',
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true, updated: res.data.updated };
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
			// valid if a workspace label of this project's workspace OR scoped to this project
			const ok =
				l &&
				proj &&
				((l.workspaceId !== null && l.workspaceId === proj.workspaceId) ||
					(l.projectId !== null && l.projectId === params.id));
			if (!ok) return fail(400, { message: 'Unknown label' });
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

		const type = String((await request.formData()).get('type') ?? '');
		const res = await createViewService(params.id, { type }, locals.user, { broadcast: true });
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true, viewId: res.data.id };
	},

	/** Re-enables a hidden view, keeping its config. */
	unhideView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const id = String((await request.formData()).get('id') ?? '');
		const res = await updateViewById(id, { hidden: false }, locals.user, {
			has: (key) => key === 'hidden',
			owner: { projectId: params.id },
			broadcast: true
		});
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true, viewId: id };
	},

	duplicateView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const id = String((await request.formData()).get('id') ?? '');
		const res = await duplicateViewService(params.id, id, locals.user, { broadcast: true });
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true, viewId: res.data.id };
	},

	deleteView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const id = String((await request.formData()).get('id') ?? '');
		const res = await deleteViewById(id, locals.user, {
			owner: { projectId: params.id },
			broadcast: true
		});
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/** Updates a view's name and/or config (config untouched when not posted). */
	updateView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const configRaw = form.get('config');
		const res = await updateViewById(
			String(form.get('id') ?? ''),
			{ name: String(form.get('name') ?? ''), config: configRaw === null ? undefined : String(configRaw) },
			locals.user,
			{ has: (key) => (key === 'name' ? true : key === 'config' ? configRaw !== null : false), owner: { projectId: params.id }, broadcast: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/** Reorders the project's views (drag-and-drop tabs). Body: `ids` = comma-separated view ids. */
	reorderView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const ids = String((await request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const res = await reorderViews(params.id, ids, locals.user, { broadcast: true });
		if (!res.ok) return fail(res.status, { message: res.message });
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
			if (!ICON_NAMES.includes(raw.slice(8))) return fail(400, { message: 'Unknown icon' });
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

		const form = await request.formData();
		const res = await createMilestoneService(
			params.id,
			{
				name: String(form.get('name') ?? ''),
				description: String(form.get('description') ?? '').trim() || null,
				startDate: String(form.get('startDate') ?? ''),
				targetDate: String(form.get('targetDate') ?? ''),
				assignTaskId: String(form.get('taskId') ?? '') || null
			},
			locals.user,
			{ broadcast: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true, milestoneId: res.data.id };
	},

	/** Reorder milestones from a comma-separated ordered id list (`ids`). */
	reorderMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const ids = String((await request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		await reorderMilestones(params.id, ids);
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
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
		const res = await updateMilestoneById(
			String(form.get('id') ?? ''),
			{
				name: form.has('name') ? String(form.get('name') ?? '') : undefined,
				description: form.has('description')
					? String(form.get('description') ?? '').trim() || null
					: undefined,
				startDate: form.has('startDate') ? String(form.get('startDate') ?? '').trim() : undefined,
				targetDate: form.has('targetDate') ? String(form.get('targetDate') ?? '').trim() : undefined
			},
			locals.user,
			{ has: (key) => form.has(key), owner: { projectId: params.id }, broadcast: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	deleteMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const id = String((await request.formData()).get('id') ?? '');
		const res = await deleteMilestoneById(id, locals.user, {
			owner: { projectId: params.id },
			broadcast: true
		});
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	addMilestoneDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const res = await addMilestoneDepService(
			String(form.get('milestoneId') ?? ''),
			String(form.get('dependsOnId') ?? ''),
			locals.user,
			{ owner: { projectId: params.id }, broadcast: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/** Replaces a milestone's full dependency set. Body: `milestoneId` + repeated `dependsOnId`. */
	setMilestoneDeps: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const res = await setMilestoneDepsService(
			String(form.get('milestoneId') ?? ''),
			form.getAll('dependsOnId').map(String),
			locals.user,
			{ owner: { projectId: params.id }, broadcast: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	removeMilestoneDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const res = await removeMilestoneDepService(
			String(form.get('milestoneId') ?? ''),
			String(form.get('dependsOnId') ?? ''),
			locals.user,
			{ owner: { projectId: params.id }, broadcast: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	deleteProject: async ({ params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });
		await deleteFilesForProject(params.id);
		await db.delete(project).where(eq(project.id, params.id));
		broadcastProjectChange(params.id, locals.user.id);
		redirect(303, '/projects');
	},

	/** Hides a view (config kept; the "+" menu re-enables it). */
	hideView: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const id = String((await request.formData()).get('id') ?? '');
		const res = await updateViewById(id, { hidden: true }, locals.user, {
			has: (key) => key === 'hidden',
			owner: { projectId: params.id },
			broadcast: true
		});
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	}
};
