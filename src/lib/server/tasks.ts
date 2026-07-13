import { and, count, eq, inArray, isNull, asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { file, label, location, milestone, project, task, taskLabel, user } from '$lib/server/db/schema';
import { PRIORITIES } from '$lib/server/api';
import { dispatchEvent } from '$lib/server/integrations';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { notifyMentions } from '$lib/server/mentions';
import { logActivity } from '$lib/server/comments';
import { create as createNotification } from '$lib/server/notifications';
import { isValidRecurrence, nextDueDate } from '$lib/recurrence';
import { listProjectStatuses } from '$lib/server/statuses';
import { canAccessProject, canEditTask } from '$lib/server/permissions';
import { writeTaskCustomValues } from '$lib/server/customFields';

export type Actor = { id: string; name?: string | null };

export type ServiceResult<T> =
	| { ok: true; data: T }
	| { ok: false; status: number; message: string };

const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });
const err = (status: number, message: string): ServiceResult<never> => ({ ok: false, status, message });

/** Custom-field entries (`{ fieldId, raw }`) passed straight to writeTaskCustomValues. */
type CfEntry = { fieldId: string; raw: string | null };

async function getTask(id: string) {
	const [t] = await db.select().from(task).where(eq(task.id, id));
	return t ?? null;
}

function isPriority(p: string): boolean {
	return PRIORITIES.includes(p as (typeof PRIORITIES)[number]);
}

/* --------------------------------- create --------------------------------- */

export type CreateTaskInput = {
	projectId: string;
	title: string;
	parentId?: string | null;
	priority?: string;
	/** Resolve by exact id (form action + REST statusId). */
	statusId?: string;
	/** Resolve by case-insensitive name (REST `status`). Ignored if statusId given. */
	statusName?: string;
	assigneeId?: string | null;
	milestoneId?: string | null;
	locationId?: string | null;
	/** Legacy freeform location text (REST only). */
	location?: string | null;
	description?: string | null;
	order?: number | null;
	dueDate?: Date | null;
	/** Custom-field writes. */
	cf?: CfEntry[];
	/** Label prefill (form action label-grouped quick-add); invalid ones are silently skipped. */
	labelId?: string | null;
	/** Emit a `created` activity row (form action does; REST does not). */
	logCreate?: boolean;
};

export async function createTaskService(
	input: CreateTaskInput,
	actor: Actor
): Promise<ServiceResult<typeof task.$inferSelect>> {
	const { projectId } = input;
	if (!(await canAccessProject(actor, projectId)))
		return err(403, 'No access to this project');

	const title = input.title.trim();
	const parentId = input.parentId ?? null;
	const priority = input.priority ?? 'none';

	if (!title) return err(400, 'Task title is required');
	if (title.length > 240) return err(400, 'Title too long (max 240)');
	if (!isPriority(priority)) return err(400, 'Invalid priority');

	let parent: Awaited<ReturnType<typeof getTask>> | null = null;
	if (parentId) {
		parent = await getTask(parentId);
		if (!parent || parent.projectId !== projectId) return err(400, 'Invalid parent task');
		if (parent.parentId) return err(400, 'Sub-tasks cannot have their own sub-tasks');
	}

	const eligible = await listProjectStatuses(projectId);
	let statusId: string;
	if (input.statusId !== undefined) {
		const found = eligible.find((s) => s.id === input.statusId);
		if (!found) return err(400, 'Status not eligible for this project');
		statusId = found.id;
	} else if (input.statusName !== undefined) {
		const found = eligible.find((s) => s.name.toLowerCase() === input.statusName!.toLowerCase());
		if (!found) return err(400, 'Status not eligible for this project');
		statusId = found.id;
	} else {
		const fallback = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
		if (!fallback) return err(400, 'Project has no eligible statuses');
		statusId = fallback.id;
	}

	const assigneeId = input.assigneeId ?? null;
	if (assigneeId) {
		const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, assigneeId));
		if (!u) return err(400, 'Unknown assignee');
	}
	// Sub-tasks inherit the parent's milestone (the milestone UI is hidden on sub-tasks
	// and always follows the parent); top-level tasks validate the supplied milestone.
	let milestoneId: string | null;
	if (parent) {
		milestoneId = parent.milestoneId;
	} else {
		milestoneId = input.milestoneId ?? null;
		if (milestoneId) {
			const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
			if (!m || m.projectId !== projectId) return err(400, 'Milestone must belong to this project');
		}
	}
	const locationId = input.locationId ?? null;
	if (locationId) {
		const [l] = await db.select().from(location).where(eq(location.id, locationId));
		if (!l || l.projectId !== projectId) return err(400, 'Location must belong to this project');
	}

	const now = new Date();
	const taskId = crypto.randomUUID();
	const [created] = await db
		.insert(task)
		.values({
			id: taskId,
			projectId,
			parentId,
			title,
			description: input.description ?? null,
			priority,
			statusId,
			assigneeId,
			milestoneId,
			locationId,
			location: input.location ?? null,
			order: input.order ?? null,
			dueDate: input.dueDate ?? null,
			createdBy: actor.id,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	if (input.cf && input.cf.length > 0) {
		const res = await writeTaskCustomValues(taskId, projectId, input.cf);
		if (res.error) {
			await db.delete(task).where(eq(task.id, taskId));
			return err(400, res.error);
		}
	}

	// optional label prefill (label-grouped quick-add); silently skip an invalid one
	if (input.labelId) {
		const [l] = await db.select().from(label).where(eq(label.id, input.labelId));
		const [proj0] = await db
			.select({ workspaceId: project.workspaceId })
			.from(project)
			.where(eq(project.id, projectId));
		if (l && proj0 && l.workspaceId === proj0.workspaceId)
			await db.insert(taskLabel).values({ taskId, labelId: input.labelId }).onConflictDoNothing();
	}

	const [proj] = await db.select().from(project).where(eq(project.id, projectId));
	void dispatchEvent({
		type: 'task.created',
		actor: actor.name ?? 'Unknown',
		projectName: proj?.name ?? 'Unknown project',
		taskTitle: title
	});

	if (input.logCreate) void logActivity(projectId, taskId, actor.id, 'created', { title });

	broadcastProjectChange(projectId, actor.id);
	return ok(created);
}

/* -------------------------------- setStatus -------------------------------- */

export async function setTaskStatusService(
	taskId: string,
	projectId: string,
	statusId: string,
	actor: Actor
): Promise<ServiceResult<null>> {
	const existing = await getTask(taskId);
	if (!existing || existing.projectId !== projectId) return err(400, 'Invalid task');
	if (!(await canEditTask(actor, existing))) return err(403, 'No edit permission on this task');

	const eligible = await listProjectStatuses(projectId);
	const target = eligible.find((s) => s.id === statusId);
	if (!target) return err(400, 'Status not eligible for this project');

	await db.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.id, taskId));

	void logActivity(projectId, taskId, actor.id, 'status', { to: statusId });

	// Recurring task: when it moves into a completed status, spawn the next
	// occurrence with its due date advanced by the recurrence rule (BASDEV-8).
	const wasCompleted =
		eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
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
				createdBy: actor.id,
				position: spawnNow.getTime(),
				createdAt: spawnNow,
				updatedAt: spawnNow
			});
		}
	}

	// Completing a parent completes its sub-tasks
	if (target.category === 'completed') {
		await db.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.parentId, taskId));
	}

	const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
	if (target.category === 'completed' && !wasDone) {
		const [proj] = await db.select().from(project).where(eq(project.id, existing.projectId));
		void dispatchEvent({
			type: 'task.completed',
			actor: actor.name ?? 'Unknown',
			projectName: proj?.name ?? 'Unknown project',
			taskTitle: existing.title
		});
	}

	broadcastProjectChange(projectId, actor.id);
	return ok(null);
}

/* --------------------------------- moveTask -------------------------------- */

export async function moveTaskService(
	taskId: string,
	projectId: string,
	statusId: string,
	beforeId: string | null,
	actor: Actor
): Promise<ServiceResult<null>> {
	const existing = await getTask(taskId);
	if (!existing || existing.projectId !== projectId || existing.parentId)
		return err(400, 'Invalid task');
	if (!(await canEditTask(actor, existing))) return err(403, 'No edit permission on this task');

	const eligible = await listProjectStatuses(projectId);
	const target = eligible.find((s) => s.id === statusId);
	if (!target) return err(400, 'Status not eligible for this project');

	const colTasks = (
		await db
			.select()
			.from(task)
			.where(and(eq(task.projectId, projectId), eq(task.statusId, statusId), isNull(task.parentId)))
			.orderBy(asc(task.position), asc(task.createdAt))
	).filter((t) => t.id !== taskId);

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
		.where(eq(task.id, taskId));

	const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
	if (target.category === 'completed') {
		await db.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.parentId, taskId));
	}
	if (target.category === 'completed' && !wasDone) {
		const [proj] = await db.select().from(project).where(eq(project.id, projectId));
		void dispatchEvent({
			type: 'task.completed',
			actor: actor.name ?? 'Unknown',
			projectName: proj?.name ?? 'Unknown project',
			taskTitle: existing.title
		});
	}

	broadcastProjectChange(projectId, actor.id);
	return ok(null);
}

/* -------------------------------- updateTask ------------------------------- */

/**
 * A partial task patch: only keys PRESENT here are changed (absent = untouched),
 * preserving the `form.has`/`field in body` semantics of both callers. Each value
 * is already parsed by the adapter; the service validates references + writes.
 */
export type UpdateTaskInput = {
	title?: string;
	description?: string | null;
	priority?: string;
	/** status by id (both) or by name (REST). Only one is set by the adapter. */
	statusId?: string;
	statusName?: string;
	assigneeId?: string | null;
	milestoneId?: string | null;
	locationId?: string | null;
	/** Legacy freeform location text (REST). */
	location?: string | null;
	order?: number | null;
	startDate?: Date | null;
	dueDate?: Date | null;
	recurrence?: string | null;
	coverFileId?: string | null;
	parentId?: string | null;
	cf?: CfEntry[];
};

export type UpdateTaskOptions = {
	/**
	 * Which key of `input` was actually supplied by the caller (mirrors `form.has`
	 * / `key in body`). Absent keys are ignored even if present-but-undefined.
	 */
	has: (key: keyof UpdateTaskInput) => boolean;
	/**
	 * When a status change moves the task into a completed category:
	 * cascade the status onto sub-tasks + spawn a recurrence occurrence.
	 * The form-action patchTask does NOT do this (only setStatus/moveTask);
	 * the REST PATCH does. Default false.
	 */
	completeCascade?: boolean;
	/** Fire the per-field `logActivity` rows (form action). Default false. */
	logActivity?: boolean;
	/** Fire `notifyMentions` on a description change (form action). Default false. */
	notifyMentionsOnDescription?: boolean;
	/** Notify a newly-assigned user (REST PATCH). Default false. */
	notifyAssignee?: boolean;
};

export async function updateTaskService(
	taskId: string,
	projectId: string,
	input: UpdateTaskInput,
	actor: Actor,
	opts: UpdateTaskOptions
): Promise<ServiceResult<typeof task.$inferSelect>> {
	const existing = await getTask(taskId);
	if (!existing || existing.projectId !== projectId) return err(400, 'Invalid task');
	if (!(await canEditTask(actor, existing))) return err(403, 'No edit permission on this task');

	const eligible = await listProjectStatuses(projectId);
	const set: Partial<typeof task.$inferInsert> = {};
	let targetStatus: (typeof eligible)[number] | undefined;
	let newAssigneeId: string | null | undefined;

	if (opts.has('title')) {
		const title = (input.title ?? '').trim();
		if (!title) return err(400, 'Task title is required');
		if (title.length > 240) return err(400, 'Title too long (max 240)');
		set.title = title;
	}
	if (opts.has('description')) {
		const d = input.description;
		set.description = typeof d === 'string' ? d.trim() || null : (d ?? null);
	}
	if (opts.has('priority')) {
		const priority = input.priority ?? 'none';
		if (!isPriority(priority)) return err(400, 'Invalid priority');
		set.priority = priority;
	}
	if (opts.has('statusId') || opts.has('statusName')) {
		if (opts.has('statusId')) targetStatus = eligible.find((s) => s.id === input.statusId);
		else
			targetStatus = eligible.find(
				(s) => s.name.toLowerCase() === (input.statusName ?? '').toLowerCase()
			);
		if (!targetStatus) return err(400, 'Status not eligible for this project');
		set.statusId = targetStatus.id;
	}
	if (opts.has('assigneeId')) {
		newAssigneeId = input.assigneeId ?? null;
		if (newAssigneeId) {
			const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, newAssigneeId));
			if (!u) return err(400, 'Unknown assignee');
		}
		set.assigneeId = newAssigneeId;
	}
	if (opts.has('milestoneId')) {
		const milestoneId = input.milestoneId ?? null;
		if (milestoneId) {
			const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
			if (!m || m.projectId !== projectId)
				return err(400, 'Milestone must belong to this project');
		}
		set.milestoneId = milestoneId;
	}
	if (opts.has('locationId')) {
		const locationId = input.locationId ?? null;
		if (locationId) {
			const [l] = await db.select().from(location).where(eq(location.id, locationId));
			if (!l || l.projectId !== projectId)
				return err(400, 'Location must belong to this project');
		}
		set.locationId = locationId;
	}
	if (opts.has('location')) {
		const loc = input.location;
		set.location = typeof loc === 'string' && loc.trim() ? loc.trim() : null;
	}
	if (opts.has('order')) set.order = input.order ?? null;
	if (opts.has('startDate')) set.startDate = input.startDate ?? null;
	if (opts.has('dueDate')) set.dueDate = input.dueDate ?? null;
	if (opts.has('recurrence')) {
		const rec = input.recurrence ?? null;
		if (rec && !isValidRecurrence(rec)) return err(400, 'Invalid recurrence rule');
		set.recurrence = rec;
	}
	if (opts.has('coverFileId')) {
		const coverFileId = input.coverFileId ?? null;
		if (coverFileId) {
			const [f] = await db.select().from(file).where(eq(file.id, coverFileId));
			if (!f || f.taskId !== taskId || f.projectId !== projectId)
				return err(400, 'Cover must be a file attached to this task');
			if (!f.mimeType.startsWith('image/')) return err(400, 'Cover must be an image');
		}
		set.coverFileId = coverFileId;
	}
	// re-parent: nest this task under another (make it a sub-task). Depth-1 only.
	if (opts.has('parentId')) {
		const parentId = input.parentId ?? null;
		if (parentId) {
			if (parentId === taskId) return err(400, 'A task cannot be its own parent');
			const parent = await getTask(parentId);
			if (!parent || parent.projectId !== projectId)
				return err(400, 'Parent must belong to this project');
			if (parent.parentId) return err(400, 'Sub-tasks cannot have sub-tasks');
			const [{ n }] = await db
				.select({ n: count(task.id) })
				.from(task)
				.where(eq(task.parentId, taskId));
			if (n > 0) return err(400, 'Move or remove this task’s sub-tasks first');
			// becoming a sub-task → inherit the parent's milestone (sub-tasks follow it)
			set.milestoneId = parent.milestoneId;
		}
		set.parentId = parentId;
	}

	const cf = input.cf ?? [];
	if (Object.keys(set).length === 0 && cf.length === 0) return err(400, 'No fields to update');

	// Write custom values FIRST so a CF validation error doesn't leave the task
	// row partially updated with no rollback (no surrounding transaction).
	if (cf.length > 0) {
		const res = await writeTaskCustomValues(taskId, projectId, cf);
		if (res.error) return err(400, res.error);
	}

	const [updated] = await db
		.update(task)
		.set({ ...set, updatedAt: new Date() })
		.where(eq(task.id, taskId))
		.returning();

	// Completing a parent completes its sub-tasks + recurrence spawn (REST PATCH).
	if (opts.completeCascade) {
		const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
		if (targetStatus?.category === 'completed' && !wasDone) {
			if (existing.recurrence) {
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
						createdBy: actor.id,
						position: spawnNow.getTime(),
						createdAt: spawnNow,
						updatedAt: spawnNow
					});
				}
			}

			await db
				.update(task)
				.set({ statusId: targetStatus.id, updatedAt: new Date() })
				.where(eq(task.parentId, taskId));

			const [proj] = await db.select().from(project).where(eq(project.id, projectId));
			void dispatchEvent({
				type: 'task.completed',
				actor: actor.name ?? 'Unknown',
				projectName: proj?.name ?? 'Unknown project',
				taskTitle: updated.title
			});
		}
	}

	if (opts.logActivity) {
		if (set.title !== undefined && set.title !== existing.title)
			void logActivity(projectId, taskId, actor.id, 'title', {
				from: existing.title,
				to: set.title
			});
		if (set.statusId !== undefined && set.statusId !== existing.statusId)
			void logActivity(projectId, taskId, actor.id, 'status', { to: set.statusId });
		if (set.assigneeId !== undefined && set.assigneeId !== existing.assigneeId)
			void logActivity(projectId, taskId, actor.id, 'assignee', { to: set.assigneeId });
		if (set.milestoneId !== undefined && set.milestoneId !== existing.milestoneId)
			void logActivity(projectId, taskId, actor.id, 'milestone', { to: set.milestoneId });
		if (set.priority !== undefined && set.priority !== existing.priority)
			void logActivity(projectId, taskId, actor.id, 'priority', { to: set.priority });
		if (set.dueDate !== undefined)
			void logActivity(projectId, taskId, actor.id, 'due', {
				to: set.dueDate ? new Date(set.dueDate).toISOString().slice(0, 10) : null
			});
		if (set.parentId !== undefined && set.parentId !== existing.parentId)
			void logActivity(projectId, taskId, actor.id, 'parent', {
				from: existing.parentId,
				to: set.parentId
			});
	}

	if (opts.notifyMentionsOnDescription && set.description !== undefined)
		void notifyMentions({
			text: set.description,
			prevText: existing.description,
			actorId: actor.id,
			actorName: actor.name,
			projectId,
			taskId,
			contextLabel: `"${existing.title}"`
		});

	if (
		opts.notifyAssignee &&
		newAssigneeId !== undefined &&
		newAssigneeId &&
		newAssigneeId !== existing.assigneeId &&
		newAssigneeId !== actor.id
	) {
		void createNotification({
			userId: newAssigneeId,
			type: 'assigned',
			body: `You were assigned to "${updated.title}"`,
			projectId,
			taskId
		});
	}

	broadcastProjectChange(projectId, actor.id);
	return ok(updated);
}

/* -------------------------------- deleteTask ------------------------------- */

export async function deleteTaskService(
	taskId: string,
	projectId: string,
	actor: Actor
): Promise<ServiceResult<null>> {
	const existing = await getTask(taskId);
	if (!existing || existing.projectId !== projectId) return err(400, 'Invalid task');
	if (!(await canEditTask(actor, existing))) return err(403, 'No edit permission on this task');

	await db.delete(task).where(eq(task.parentId, taskId)); // sub-tasks first
	await db.delete(task).where(eq(task.id, taskId));
	broadcastProjectChange(projectId, actor.id);
	return ok(null);
}

/* -------------------------------- bulk ops -------------------------------- */

/**
 * Resolve the editable subset of `ids` scoped to `projectId`: only rows in this
 * project the actor can edit. Mirrors the form actions (project from params).
 */
async function bulkAllowed(ids: string[], projectId: string, actor: Actor): Promise<string[]> {
	const rows = await db.select().from(task).where(inArray(task.id, ids));
	const allowed: string[] = [];
	for (const t of rows) {
		if (t.projectId !== projectId) continue;
		if (await canEditTask(actor, t)) allowed.push(t.id);
	}
	return allowed;
}

export type BulkSet = {
	statusId?: string;
	statusName?: string;
	assigneeId?: string | null;
	milestoneId?: string | null;
	priority?: string;
	parentId?: string | null;
	addLabelIds?: string[];
	removeLabelIds?: string[];
	has: (key: 'statusId' | 'statusName' | 'assigneeId' | 'milestoneId' | 'priority' | 'parentId') => boolean;
};

export async function bulkUpdateTasks(
	ids: string[],
	projectId: string,
	set: BulkSet,
	actor: Actor
): Promise<ServiceResult<{ updated: number }>> {
	if (ids.length === 0) return err(400, 'No tasks selected');

	const updates: Partial<typeof task.$inferInsert> = {};
	// Track whether the new status completes tasks, to cascade to sub-tasks (mirrors single setStatus).
	let completedStatusId: string | null = null;

	if (set.has('statusId') || set.has('statusName')) {
		const eligible = await listProjectStatuses(projectId);
		let target: (typeof eligible)[number] | undefined;
		if (set.has('statusId')) {
			if (!set.statusId) return err(400, 'Invalid status');
			target = eligible.find((s) => s.id === set.statusId);
		} else {
			target = eligible.find(
				(s) => s.name.toLowerCase() === (set.statusName ?? '').toLowerCase()
			);
		}
		if (!target) return err(400, 'Status not eligible for this project');
		updates.statusId = target.id;
		if (target.category === 'completed') completedStatusId = target.id;
	}
	if (set.has('assigneeId')) {
		const assigneeId = set.assigneeId ?? null;
		if (assigneeId) {
			const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, assigneeId));
			if (!u) return err(400, 'Unknown assignee');
		}
		updates.assigneeId = assigneeId;
	}
	if (set.has('milestoneId')) {
		const milestoneId = set.milestoneId ?? null;
		if (milestoneId) {
			const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
			if (!m || m.projectId !== projectId)
				return err(400, 'Milestone must belong to this project');
		}
		updates.milestoneId = milestoneId;
	}
	if (set.has('priority')) {
		const priority = set.priority ?? 'none';
		if (!isPriority(priority)) return err(400, 'Invalid priority');
		updates.priority = priority;
	}
	// Move: re-parent selected tasks under another top-level task ('' = promote to top-level)
	if (set.has('parentId')) {
		const parentId = set.parentId ?? null;
		if (parentId) {
			if (ids.includes(parentId)) return err(400, 'A task cannot be moved under itself');
			const [p] = await db.select().from(task).where(eq(task.id, parentId));
			if (!p || p.projectId !== projectId) return err(400, 'Parent must belong to this project');
			if (p.parentId) return err(400, 'Parent must be a top-level task');
		}
		updates.parentId = parentId;
	}

	const addLabelIds = set.addLabelIds ?? [];
	const removeLabelIds = set.removeLabelIds ?? [];
	const labelChanges = addLabelIds.length > 0 || removeLabelIds.length > 0;
	if (labelChanges) {
		const refIds = [...new Set([...addLabelIds, ...removeLabelIds])];
		const labelRows = await db.select().from(label).where(inArray(label.id, refIds));
		const [proj] = await db.select().from(project).where(eq(project.id, projectId));
		const valid = new Set(
			labelRows
				.filter(
					(l) =>
						proj &&
						((l.workspaceId !== null && l.workspaceId === proj.workspaceId) ||
							(l.projectId !== null && l.projectId === projectId))
				)
				.map((l) => l.id)
		);
		for (const id of refIds)
			if (!valid.has(id)) return err(400, `label ${id} is not available to this project`);
	}

	if (Object.keys(updates).length === 0 && !labelChanges) return err(400, 'No fields to update');

	const allowed = await bulkAllowed(ids, projectId, actor);
	if (allowed.length === 0) return err(403, 'No editable tasks selected');

	// re-parenting only applies to childless tasks (one nesting level)
	if (updates.parentId !== undefined && updates.parentId !== null) {
		const kids = await db
			.select({ parentId: task.parentId })
			.from(task)
			.where(inArray(task.parentId, allowed));
		if (kids.length) return err(400, 'Cannot move a task that has sub-tasks');
	}

	if (Object.keys(updates).length > 0)
		await db
			.update(task)
			.set({ ...updates, updatedAt: new Date() })
			.where(inArray(task.id, allowed));

	// Completing a task completes its sub-tasks (mirrors single setStatus cascade).
	if (completedStatusId)
		await db
			.update(task)
			.set({ statusId: completedStatusId, updatedAt: new Date() })
			.where(inArray(task.parentId, allowed));

	if (addLabelIds.length)
		await db
			.insert(taskLabel)
			.values(allowed.flatMap((taskId) => addLabelIds.map((labelId) => ({ taskId, labelId }))))
			.onConflictDoNothing();
	if (removeLabelIds.length)
		await db
			.delete(taskLabel)
			.where(and(inArray(taskLabel.taskId, allowed), inArray(taskLabel.labelId, removeLabelIds)));

	broadcastProjectChange(projectId, actor.id);
	return ok({ updated: allowed.length });
}

export async function bulkReparentToNew(
	ids: string[],
	projectId: string,
	title: string,
	actor: Actor
): Promise<ServiceResult<{ parentId: string; moved: number }>> {
	if (!(await canAccessProject(actor, projectId))) return err(403, 'No access to this project');

	const trimmed = title.trim();
	if (!trimmed) return err(400, 'Task title is required');
	if (trimmed.length > 240) return err(400, 'Title too long (max 240)');
	if (ids.length === 0) return err(400, 'No tasks selected');

	const eligible = await listProjectStatuses(projectId);
	const defaultStatus = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
	if (!defaultStatus) return err(400, 'Project has no eligible statuses');

	const allowed = await bulkAllowed(ids, projectId, actor);
	if (allowed.length === 0) return err(403, 'No editable tasks selected');
	const kids = await db.select({ id: task.id }).from(task).where(inArray(task.parentId, allowed));
	if (kids.length) return err(400, 'Cannot move a task that has sub-tasks');

	const now = new Date();
	const newId = crypto.randomUUID();
	await db.insert(task).values({
		id: newId,
		projectId,
		parentId: null,
		title: trimmed,
		priority: 'none',
		statusId: defaultStatus.id,
		createdBy: actor.id,
		position: now.getTime(),
		createdAt: now,
		updatedAt: now
	});
	await db.update(task).set({ parentId: newId, updatedAt: now }).where(inArray(task.id, allowed));

	broadcastProjectChange(projectId, actor.id);
	return ok({ parentId: newId, moved: allowed.length });
}

export async function bulkDeleteTasks(
	ids: string[],
	projectId: string,
	actor: Actor
): Promise<ServiceResult<{ deleted: number }>> {
	if (ids.length === 0) return err(400, 'No tasks selected');

	const allowed = await bulkAllowed(ids, projectId, actor);
	if (allowed.length === 0) return err(403, 'No deletable tasks selected');

	await db.delete(task).where(inArray(task.parentId, allowed)); // sub-tasks first
	await db.delete(task).where(inArray(task.id, allowed));

	broadcastProjectChange(projectId, actor.id);
	return ok({ deleted: allowed.length });
}

export async function bulkSetLabel(
	ids: string[],
	projectId: string,
	labelId: string,
	add: boolean,
	actor: Actor
): Promise<ServiceResult<{ updated: number }>> {
	if (ids.length === 0) return err(400, 'No tasks selected');
	if (!labelId) return err(400, 'Invalid label');

	// label must be a workspace label of this project's workspace OR scoped to it
	const [l] = await db.select().from(label).where(eq(label.id, labelId));
	const [proj] = await db.select().from(project).where(eq(project.id, projectId));
	const valid =
		l &&
		proj &&
		((l.workspaceId !== null && l.workspaceId === proj.workspaceId) ||
			(l.projectId !== null && l.projectId === projectId));
	if (!valid) return err(400, 'Unknown label');

	const allowed = await bulkAllowed(ids, projectId, actor);
	if (allowed.length === 0) return err(403, 'No editable tasks selected');

	if (add) {
		await db
			.insert(taskLabel)
			.values(allowed.map((taskId) => ({ taskId, labelId })))
			.onConflictDoNothing();
	} else {
		await db
			.delete(taskLabel)
			.where(and(inArray(taskLabel.taskId, allowed), eq(taskLabel.labelId, labelId)));
	}

	broadcastProjectChange(projectId, actor.id);
	return ok({ updated: allowed.length });
}
