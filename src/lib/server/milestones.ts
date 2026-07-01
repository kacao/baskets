import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { milestone, milestoneDependency, project, status, task } from './db/schema';
import { parseDateField, ApiValidationError } from '$lib/server/api';
import { createsCycle } from '$lib/server/graph';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject, canEditTask } from '$lib/server/permissions';

/** The acting user; carries `role` so permission checks can honor admin bypass. */
export type Actor = { id: string; role?: string | null } | null | undefined;

export type ServiceResult<T> =
	| { ok: true; data: T }
	| { ok: false; status: number; message: string };

const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });
const err = (status: number, message: string): ServiceResult<never> => ({ ok: false, status, message });

type MilestoneRow = typeof milestone.$inferSelect;

export type MilestoneProgress = { done: number; total: number; pct: number };

/**
 * Per-milestone task progress for a project — top-level tasks only, `done` = a task in a
 * `completed`-category status. Returned as a map keyed by milestone id (absent = no tasks).
 * Computed in ONE join so the settings/milestones surfaces don't need the full task list.
 */
export async function milestoneProgressByProject(
	projectId: string
): Promise<Record<string, MilestoneProgress>> {
	const rows = await db
		.select({ milestoneId: task.milestoneId, category: status.category })
		.from(task)
		.leftJoin(status, eq(task.statusId, status.id))
		.where(and(eq(task.projectId, projectId), isNull(task.parentId)));

	const acc: Record<string, MilestoneProgress> = {};
	for (const r of rows) {
		if (!r.milestoneId) continue;
		const a = (acc[r.milestoneId] ??= { done: 0, total: 0, pct: 0 });
		a.total++;
		if (r.category === 'completed') a.done++;
	}
	for (const k in acc) acc[k].pct = acc[k].total ? Math.round((acc[k].done / acc[k].total) * 100) : 0;
	return acc;
}

/**
 * Rewrite `milestone.position` from an ordered id list. Ignores foreign ids; any of the
 * project's milestones missing from the list keep their relative order AFTER the listed
 * ones (sorted by their current position).
 */
export async function reorderMilestones(projectId: string, ids: string[]): Promise<void> {
	const owned = await db
		.select({ id: milestone.id })
		.from(milestone)
		.where(eq(milestone.projectId, projectId))
		.orderBy(asc(milestone.position), asc(milestone.createdAt));
	const validOrder = owned.map((m) => m.id);
	const seen = new Set<string>();
	const ordered = [
		...ids.filter((id) => validOrder.includes(id) && !seen.has(id) && seen.add(id)),
		...validOrder.filter((id) => !seen.has(id))
	];
	const now = new Date();
	for (let i = 0; i < ordered.length; i++) {
		await db.update(milestone).set({ position: i, updatedAt: now }).where(eq(milestone.id, ordered[i]));
	}
}

/* --------------------------------- create --------------------------------- */

export type CreateMilestoneInput = {
	name: string;
	description?: string | null;
	/** Pre-parsed Date | null, OR a raw string/unknown the service parses via parseDateField. */
	startDate?: Date | string | null;
	targetDate?: Date | string | null;
	/** Task-pane create-and-assign: assign the new milestone to this task (best-effort). */
	assignTaskId?: string | null;
};

/**
 * Create a milestone under a project (structure edit). Mirrors the createMilestone
 * form actions (project page + settings) + POST /api/projects/[id]/milestones.
 * Optional `assignTaskId` assigns the new milestone to a task in one step (task-pane).
 */
export async function createMilestone(
	projectId: string,
	input: CreateMilestoneInput,
	actor: Actor,
	opts: { broadcast?: boolean; maxNameLen?: number } = {}
): Promise<ServiceResult<MilestoneRow>> {
	// existence + access + edit gate (404-before-403 per ADR-019)
	const [proj] = await db.select({ id: project.id }).from(project).where(eq(project.id, projectId));
	if (!proj) return err(404, 'Project not found');
	if (!(await canAccessProject(actor, projectId))) return err(404, 'Project not found');
	if (!(await canEditProject(actor, projectId)))
		return err(403, 'No edit permission on this project');

	const name = (input.name ?? '').trim();
	if (!name) return err(400, 'Milestone name is required');
	if (opts.maxNameLen && name.length > opts.maxNameLen) return err(400, 'name too long (max 120)');

	const description =
		typeof input.description === 'string' ? input.description.trim() || null : (input.description ?? null);

	let startDate: Date | null;
	let targetDate: Date | null;
	try {
		startDate = input.startDate instanceof Date ? input.startDate : parseDateField(input.startDate);
		targetDate = input.targetDate instanceof Date ? input.targetDate : parseDateField(input.targetDate);
	} catch (e) {
		if (e instanceof ApiValidationError) return err(400, e.message);
		throw e;
	}

	const now = new Date();
	const id = crypto.randomUUID();
	const [created] = await db
		.insert(milestone)
		.values({
			id,
			projectId,
			name,
			description,
			startDate,
			targetDate,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	// optionally assign the new milestone to a task in one step (task-pane create)
	if (input.assignTaskId) {
		const [t] = await db.select().from(task).where(eq(task.id, input.assignTaskId));
		if (t && t.projectId === projectId && (await canEditTask(actor, t)))
			await db.update(task).set({ milestoneId: id, updatedAt: now }).where(eq(task.id, input.assignTaskId));
	}

	if (opts.broadcast) broadcastProjectChange(projectId, actor!.id);
	return ok(created);
}

/* --------------------------------- update --------------------------------- */

export type UpdateMilestoneInput = {
	name?: string;
	description?: string | null;
	startDate?: Date | string | null;
	targetDate?: Date | string | null;
};

/**
 * Patch a milestone (only keys in `has` are touched). Gated by the milestone's own
 * project per ADR-019 (REST 404-before-403) OR a form-action `owner` scope. Mirrors
 * updateMilestone form actions + PATCH /api/milestones/[id].
 */
export async function updateMilestoneById(
	id: string,
	input: UpdateMilestoneInput,
	actor: Actor,
	opts: {
		has: (key: keyof UpdateMilestoneInput) => boolean;
		broadcast?: boolean;
		/** Form-action ownership assertion: the milestone must belong to this project. */
		owner?: { projectId: string };
		/** REST caps name at 120; the form actions have no cap. */
		maxNameLen?: number;
	}
): Promise<ServiceResult<MilestoneRow>> {
	const [ms] = await db.select().from(milestone).where(eq(milestone.id, id));
	if (!ms) {
		if (opts.owner) return err(400, 'Invalid milestone');
		return err(404, 'Milestone not found');
	}

	if (opts.owner) {
		if (ms.projectId !== opts.owner.projectId) return err(400, 'Invalid milestone');
	} else {
		if (!(await canAccessProject(actor, ms.projectId))) return err(404, 'Milestone not found');
		if (!(await canEditProject(actor, ms.projectId)))
			return err(403, 'No edit permission on this project');
	}

	const updates: Partial<typeof milestone.$inferInsert> = {};
	if (opts.has('name')) {
		const name = (input.name ?? '').trim();
		if (!name) return err(400, 'Milestone name is required');
		if (opts.maxNameLen && name.length > opts.maxNameLen) return err(400, 'name too long (max 120)');
		updates.name = name;
	}
	if (opts.has('description')) {
		const d = input.description;
		updates.description = typeof d === 'string' ? d.trim() || null : (d ?? null);
	}
	try {
		if (opts.has('startDate'))
			updates.startDate = input.startDate instanceof Date ? input.startDate : parseDateField(input.startDate);
		if (opts.has('targetDate'))
			updates.targetDate =
				input.targetDate instanceof Date ? input.targetDate : parseDateField(input.targetDate);
	} catch (e) {
		if (e instanceof ApiValidationError) return err(400, e.message);
		throw e;
	}

	if (Object.keys(updates).length === 0) return err(400, 'No fields to update');

	const [updated] = await db
		.update(milestone)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(milestone.id, id))
		.returning();

	if (opts.broadcast) broadcastProjectChange(ms.projectId, actor!.id);
	return ok(updated);
}

/* --------------------------------- delete --------------------------------- */

/**
 * Delete a milestone by id. Gated by its own project per ADR-019 (REST 404-before-403)
 * OR by a form-action `owner` scope (a scoped no-op delete, matching deleteMilestone's
 * `and(...)` where). Mirrors deleteMilestone form actions + DELETE /api/milestones/[id].
 */
export async function deleteMilestoneById(
	id: string,
	actor: Actor,
	opts: { broadcast?: boolean; owner?: { projectId: string } } = {}
): Promise<ServiceResult<null>> {
	if (opts.owner) {
		await db.delete(milestone).where(and(eq(milestone.id, id), eq(milestone.projectId, opts.owner.projectId)));
		if (opts.broadcast) broadcastProjectChange(opts.owner.projectId, actor!.id);
		return ok(null);
	}

	const [ms] = await db.select().from(milestone).where(eq(milestone.id, id));
	if (!ms) return err(404, 'Milestone not found');
	if (!(await canAccessProject(actor, ms.projectId))) return err(404, 'Milestone not found');
	if (!(await canEditProject(actor, ms.projectId)))
		return err(403, 'No edit permission on this project');

	await db.delete(milestone).where(eq(milestone.id, id));
	if (opts.broadcast) broadcastProjectChange(ms.projectId, actor!.id);
	return ok(null);
}

/* ------------------------------- dependencies ------------------------------ */

/** All dependency edges among a project's milestones as an adjacency map. */
async function milestoneEdges(projectId: string) {
	const all = await db
		.select({
			milestoneId: milestoneDependency.milestoneId,
			dependsOnId: milestoneDependency.dependsOnId
		})
		.from(milestoneDependency)
		.innerJoin(milestone, eq(milestoneDependency.milestoneId, milestone.id))
		.where(eq(milestone.projectId, projectId));
	const edges = new Map<string, string[]>();
	for (const e of all) edges.set(e.milestoneId, [...(edges.get(e.milestoneId) ?? []), e.dependsOnId]);
	return edges;
}

/**
 * Add ONE dependency edge { dependsOnId } to a milestone (same-project, DFS cycle-checked).
 * Gated by the milestone's own project per ADR-019 OR a form-action `owner` scope. Mirrors
 * addMilestoneDep form action + POST /api/milestones/[id]/dependencies.
 */
export async function addMilestoneDep(
	milestoneId: string,
	dependsOnId: string,
	actor: Actor,
	opts: { broadcast?: boolean; owner?: { projectId: string } } = {}
): Promise<ServiceResult<null>> {
	const [ms] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
	if (!ms) {
		if (opts.owner) return err(400, 'Both milestones must belong to this project');
		return err(404, 'Milestone not found');
	}
	if (opts.owner) {
		if (ms.projectId !== opts.owner.projectId)
			return err(400, 'Both milestones must belong to this project');
	} else {
		if (!(await canAccessProject(actor, ms.projectId))) return err(404, 'Milestone not found');
		if (!(await canEditProject(actor, ms.projectId)))
			return err(403, 'No edit permission on this project');
	}

	if (!dependsOnId) return err(400, 'dependsOnId is required');
	if (dependsOnId === milestoneId) return err(400, 'A milestone cannot depend on itself');

	const [dep] = await db.select().from(milestone).where(eq(milestone.id, dependsOnId));
	if (!dep || dep.projectId !== ms.projectId)
		return err(400, 'Both milestones must belong to this project');

	const edges = await milestoneEdges(ms.projectId);
	if (createsCycle(edges, milestoneId, dependsOnId))
		return err(400, 'That dependency would create a cycle');

	await db
		.insert(milestoneDependency)
		.values({ milestoneId, dependsOnId })
		.onConflictDoNothing();

	if (opts.broadcast) broadcastProjectChange(ms.projectId, actor!.id);
	return ok(null);
}

/**
 * Replace a milestone's FULL dependency set from `dependsOnIds` — filtered to same-project
 * ids (≠ self), then re-added one by one skipping any that would close a cycle. Gated by
 * the milestone's own project per ADR-019 OR a form-action `owner` scope. Mirrors
 * setMilestoneDeps form actions + PUT /api/milestones/[id]/dependencies.
 * Returns the accepted (non-cyclic) dependency ids.
 */
export async function setMilestoneDeps(
	milestoneId: string,
	dependsOnIds: string[],
	actor: Actor,
	opts: { broadcast?: boolean; owner?: { projectId: string } } = {}
): Promise<ServiceResult<string[]>> {
	const [m] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
	if (!m) {
		if (opts.owner) return err(400, 'Invalid milestone');
		return err(404, 'Milestone not found');
	}
	if (opts.owner) {
		if (m.projectId !== opts.owner.projectId) return err(400, 'Invalid milestone');
	} else {
		if (!(await canAccessProject(actor, m.projectId))) return err(404, 'Milestone not found');
		if (!(await canEditProject(actor, m.projectId)))
			return err(403, 'No edit permission on this project');
	}

	const projectMs = await db
		.select({ id: milestone.id })
		.from(milestone)
		.where(eq(milestone.projectId, m.projectId));
	const validIds = new Set(projectMs.map((r) => r.id));
	const desired = [...new Set(dependsOnIds.map(String))].filter(
		(id) => id && id !== milestoneId && validIds.has(id)
	);

	// edges minus this milestone's current deps; re-add desired one by one, skipping cycles
	const edges = await milestoneEdges(m.projectId);
	edges.delete(milestoneId);

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

	if (opts.broadcast) broadcastProjectChange(m.projectId, actor!.id);
	return ok(accepted);
}

/**
 * Remove ONE dependency edge. Gated by the milestone's own project per ADR-019 OR a
 * form-action `owner` scope (an unconditional scoped delete, matching removeMilestoneDep).
 * Mirrors removeMilestoneDep form action + DELETE /api/milestones/[id]/dependencies.
 */
export async function removeMilestoneDep(
	milestoneId: string,
	dependsOnId: string,
	actor: Actor,
	opts: { broadcast?: boolean; owner?: { projectId: string } } = {}
): Promise<ServiceResult<null>> {
	if (opts.owner) {
		await db
			.delete(milestoneDependency)
			.where(
				and(
					eq(milestoneDependency.milestoneId, milestoneId),
					eq(milestoneDependency.dependsOnId, dependsOnId)
				)
			);
		if (opts.broadcast) broadcastProjectChange(opts.owner.projectId, actor!.id);
		return ok(null);
	}

	const [ms] = await db.select().from(milestone).where(eq(milestone.id, milestoneId));
	if (!ms) return err(404, 'Milestone not found');
	if (!(await canAccessProject(actor, ms.projectId))) return err(404, 'Milestone not found');
	if (!(await canEditProject(actor, ms.projectId)))
		return err(403, 'No edit permission on this project');

	if (!dependsOnId) return err(400, 'dependsOnId query parameter is required');

	await db
		.delete(milestoneDependency)
		.where(
			and(
				eq(milestoneDependency.milestoneId, milestoneId),
				eq(milestoneDependency.dependsOnId, dependsOnId)
			)
		);

	if (opts.broadcast) broadcastProjectChange(ms.projectId, actor!.id);
	return ok(null);
}
