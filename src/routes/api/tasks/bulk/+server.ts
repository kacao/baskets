import { json } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { canAccessProject, canEditTask } from '$lib/server/permissions';
import {
	bulkUpdateTasks,
	bulkReparentToNew,
	bulkDeleteTasks,
	type BulkSet
} from '$lib/server/tasks';
import type { RequestHandler } from './$types';

/** Parse + dedupe a string-id array from a JSON body. */
function readIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

/**
 * Loads the selected tasks, enforces they all share ONE project, and returns the
 * project id + the subset the caller may edit. Mirrors the form actions, which
 * derive the project from `params.id`; here it comes from the tasks themselves
 * (all ids must be same-project — 400 otherwise). ADR-019: rows in projects the
 * caller can't ACCESS are dropped (indistinguishable from missing → no oracle).
 */
async function loadSelection(
	locals: App.Locals,
	ids: string[]
): Promise<
	| { error: ReturnType<typeof apiError> }
	| { projectId: string; rows: (typeof task.$inferSelect)[]; allowed: string[] }
> {
	const all = await db.select().from(task).where(inArray(task.id, ids));
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
	const { projectId } = sel;

	const bulkSet: BulkSet = {
		statusId: typeof set.statusId === 'string' ? set.statusId : undefined,
		statusName:
			set.statusId === undefined && typeof set.status === 'string' ? set.status : undefined,
		assigneeId:
			set.assigneeId !== undefined
				? typeof set.assigneeId === 'string' && set.assigneeId
					? set.assigneeId
					: null
				: undefined,
		milestoneId:
			set.milestoneId !== undefined
				? typeof set.milestoneId === 'string' && set.milestoneId
					? set.milestoneId
					: null
				: undefined,
		priority: set.priority !== undefined ? (typeof set.priority === 'string' ? set.priority : '') : undefined,
		parentId: undefined,
		addLabelIds: readIds(set.addLabelIds),
		removeLabelIds: readIds(set.removeLabelIds),
		has: (key) => {
			switch (key) {
				case 'statusId':
					return typeof set.statusId === 'string';
				case 'statusName':
					return set.statusId === undefined && typeof set.status === 'string';
				case 'assigneeId':
					return set.assigneeId !== undefined;
				case 'milestoneId':
					return set.milestoneId !== undefined;
				case 'priority':
					return set.priority !== undefined;
				case 'parentId':
					return set.parentId !== undefined;
				default:
					return false;
			}
		}
	};

	// parentId type validation must match the original endpoint's messages.
	if (set.parentId !== undefined) {
		if (set.parentId === null || set.parentId === '') {
			bulkSet.parentId = null;
		} else if (typeof set.parentId === 'string') {
			bulkSet.parentId = set.parentId;
		} else {
			return apiError(400, 'parentId must be a string or null');
		}
	}

	const res = await bulkUpdateTasks(ids, projectId, bulkSet, locals.user);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ success: true, updated: res.data.updated });
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
	const { projectId } = sel;
	// Creating in this project requires access (mirrors the action's canAccessProject guard).
	if (!(await canAccessProject(locals.user, projectId)))
		return apiError(404, 'No tasks found');

	const res = await bulkReparentToNew(ids, projectId, title, locals.user);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ success: true, parentId: res.data.parentId, moved: res.data.moved }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const ids = readIds(body.ids);
	if (ids.length === 0) return apiError(400, 'ids must be a non-empty array of task ids');

	const sel = await loadSelection(locals, ids);
	if ('error' in sel) return sel.error;
	const { projectId } = sel;

	const res = await bulkDeleteTasks(ids, projectId, locals.user);
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
