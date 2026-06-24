import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { label, milestone, project, task, taskLabel, user } from '$lib/server/db/schema';
import { apiError, readJson, PRIORITIES } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditTask } from '$lib/server/permissions';
import { listProjectStatuses } from '$lib/server/statuses';
import type { RequestHandler } from './$types';

/** Parse + dedupe a string-id array from a JSON body. */
function readIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

/**
 * Loads the selected tasks, enforces they all share ONE project, and returns the
 * project id, the loaded rows, and the subset the caller may edit. Mirrors the
 * form actions, which derive the project from `params.id`; here it comes from the
 * tasks themselves (all ids must be same-project — 400 otherwise).
 */
async function loadSelection(
	locals: App.Locals,
	ids: string[]
): Promise<
	| { error: ReturnType<typeof apiError> }
	| { projectId: string; rows: (typeof task.$inferSelect)[]; allowed: string[] }
> {
	const all = await db.select().from(task).where(inArray(task.id, ids));
	// Drop rows whose project the caller can't ACCESS — they're indistinguishable from
	// missing (ADR-019), so an id from a foreign project never leaks via a 400/oracle.
	const accessCache = new Map<string, boolean>();
	const rows: (typeof task.$inferSelect)[] = [];
	for (const t of all) {
		let ok = accessCache.get(t.projectId);
		if (ok === undefined) {
			ok = await canAccessProject(locals.user, t.projectId);
			accessCache.set(t.projectId, ok);
		}
		if (ok) rows.push(t);
	}
	if (rows.length === 0) return { error: apiError(404, 'No tasks found') };

	const projectId = rows[0].projectId;
	if (rows.some((t) => t.projectId !== projectId))
		return { error: apiError(400, 'All ids must belong to the same project') };

	const allowed: string[] = [];
	for (const t of rows) {
		if (await canEditTask(locals.user, t)) allowed.push(t.id);
	}
	if (allowed.length === 0) return { error: apiError(404, 'No tasks found') };
	return { projectId, rows, allowed };
}

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const ids = readIds(body.ids);
	if (ids.length === 0) return apiError(400, 'ids must be a non-empty array of task ids');

	const set = (body.set && typeof body.set === 'object' && !Array.isArray(body.set)
		? body.set
		: null) as Record<string, unknown> | null;
	if (!set) return apiError(400, 'set must be an object');

	const sel = await loadSelection(locals, ids);
	if ('error' in sel) return sel.error;
	const { projectId, allowed } = sel;
	if (allowed.length === 0) return apiError(403, 'No editable tasks selected');

	const updates: Partial<typeof task.$inferInsert> = {};
	// Track whether the new status completes tasks, to cascade to sub-tasks (mirrors single setStatus).
	let completedStatusId: string | null = null;

	if (set.statusId !== undefined || set.status !== undefined) {
		const eligible = await listProjectStatuses(projectId);
		const target =
			typeof set.statusId === 'string'
				? eligible.find((s) => s.id === set.statusId)
				: typeof set.status === 'string'
					? eligible.find((s) => s.name.toLowerCase() === (set.status as string).toLowerCase())
					: undefined;
		if (!target)
			return apiError(400, `status must be one of: ${eligible.map((s) => s.name).join(', ')}`);
		updates.statusId = target.id;
		if (target.category === 'completed') completedStatusId = target.id;
	}

	if (set.assigneeId !== undefined) {
		const assigneeId = typeof set.assigneeId === 'string' && set.assigneeId ? set.assigneeId : null;
		if (assigneeId) {
			const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, assigneeId));
			if (!u) return apiError(400, 'assigneeId must reference a valid user');
		}
		updates.assigneeId = assigneeId;
	}

	if (set.milestoneId !== undefined) {
		const milestoneId =
			typeof set.milestoneId === 'string' && set.milestoneId ? set.milestoneId : null;
		if (milestoneId) {
			const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
			if (!m || m.projectId !== projectId)
				return apiError(400, 'milestoneId must reference a milestone of the same project');
		}
		updates.milestoneId = milestoneId;
	}

	if (set.priority !== undefined) {
		const priority = typeof set.priority === 'string' ? set.priority : '';
		if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number]))
			return apiError(400, `priority must be one of: ${PRIORITIES.join(', ')}`);
		updates.priority = priority;
	}

	// Move: re-parent selected tasks under another top-level task ('' = promote to top-level)
	if (set.parentId !== undefined) {
		if (set.parentId === null || set.parentId === '') {
			updates.parentId = null;
		} else if (typeof set.parentId === 'string') {
			if (ids.includes(set.parentId))
				return apiError(400, 'a task cannot be moved under itself');
			const [parent] = await db.select().from(task).where(eq(task.id, set.parentId));
			if (!parent || parent.projectId !== projectId)
				return apiError(400, 'parentId must reference a task of the same project');
			if (parent.parentId) return apiError(400, 'parentId must reference a top-level task');
			updates.parentId = set.parentId;
		} else {
			return apiError(400, 'parentId must be a string or null');
		}
	}

	// Labels are multi-value: `addLabelIds`/`removeLabelIds` add/remove those labels
	// across the whole selection. Every referenced label must be available to the project
	// (a workspace label of its workspace OR scoped to it) — mirrors `toggleTaskLabel`.
	const addLabelIds = readIds(set.addLabelIds);
	const removeLabelIds = readIds(set.removeLabelIds);
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
			if (!valid.has(id)) return apiError(400, `label ${id} is not available to this project`);
	}

	if (Object.keys(updates).length === 0 && !labelChanges)
		return apiError(400, 'No fields to update');

	// re-parenting only applies to childless tasks (one nesting level)
	if (updates.parentId !== undefined && updates.parentId !== null) {
		const kids = await db
			.select({ parentId: task.parentId })
			.from(task)
			.where(inArray(task.parentId, allowed));
		if (kids.length) return apiError(400, 'cannot move a task that has sub-tasks');
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

	broadcastProjectChange(projectId, locals.user.id);
	return json({ success: true, updated: allowed.length });
};

/** Creates a new top-level task and re-parents the selected tasks under it (Move → create). */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const ids = readIds(body.ids);
	if (ids.length === 0) return apiError(400, 'ids must be a non-empty array of task ids');

	const title = typeof body.title === 'string' ? body.title.trim() : '';
	if (!title) return apiError(400, 'title is required');
	if (title.length > 240) return apiError(400, 'title too long (max 240)');

	const sel = await loadSelection(locals, ids);
	if ('error' in sel) return sel.error;
	const { projectId, allowed } = sel;
	// Creating in this project requires access (mirrors the action's canAccessProject guard).
	if (!(await canAccessProject(locals.user, projectId)))
		return apiError(404, 'No tasks found');
	if (allowed.length === 0) return apiError(403, 'No editable tasks selected');

	const kids = await db
		.select({ id: task.id })
		.from(task)
		.where(inArray(task.parentId, allowed));
	if (kids.length) return apiError(400, 'cannot move a task that has sub-tasks');

	const eligible = await listProjectStatuses(projectId);
	const defaultStatus = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
	if (!defaultStatus) return apiError(400, 'project has no eligible statuses');

	const now = new Date();
	const newId = crypto.randomUUID();
	await db.insert(task).values({
		id: newId,
		projectId,
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

	broadcastProjectChange(projectId, locals.user.id);
	return json({ success: true, parentId: newId, moved: allowed.length }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const ids = readIds(body.ids);
	if (ids.length === 0) return apiError(400, 'ids must be a non-empty array of task ids');

	const sel = await loadSelection(locals, ids);
	if ('error' in sel) return sel.error;
	const { projectId, allowed } = sel;
	if (allowed.length === 0) return apiError(403, 'No deletable tasks selected');

	await db.delete(task).where(inArray(task.parentId, allowed)); // sub-tasks first
	await db.delete(task).where(inArray(task.id, allowed));

	broadcastProjectChange(projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
