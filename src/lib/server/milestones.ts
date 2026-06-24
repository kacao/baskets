import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { milestone, status, task } from './db/schema';

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
