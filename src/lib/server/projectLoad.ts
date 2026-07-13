// Pure, DB-free helpers extracted from the project page load
// (src/routes/(app)/projects/[id]/+page.server.ts) so the in-memory folds are
// unit-testable in isolation from the DB. No $lib/server/db import — callers
// pass in already-fetched rows.
import { decodeValue, computeTaskRollup, formatNumber, type RollupConfig } from '$lib/customFields';

type Field = { id: string; type: string; config: Record<string, unknown> };
type TaskCustomValueRow = { taskId: string; fieldId: string; value: string };
type ProjectCustomValueRow = { projectId: string; fieldId: string; value: string };

/**
 * Fold the base accessible-user-id set (from `projectAccessUserIds`, a DB call
 * that stays in the load) together with every user id already REFERENCED by
 * this project's data (task assignees, task-level person-field values,
 * project-level person-field values) so existing values still resolve to a
 * name without leaking the whole roster (ADR-019). Mutates and returns `base`.
 */
export function collectVisibleUserIds(
	base: Set<string>,
	tasks: { assigneeId: string | null }[],
	taskFields: Field[],
	taskValues: TaskCustomValueRow[],
	projectFields: Field[],
	projectValues: ProjectCustomValueRow[]
): Set<string> {
	for (const tk of tasks) if (tk.assigneeId) base.add(tk.assigneeId);
	for (const f of taskFields) {
		if (f.type !== 'person') continue;
		for (const v of taskValues) {
			if (v.fieldId !== f.id) continue;
			const ids = decodeValue({ type: 'person' }, v.value);
			if (Array.isArray(ids)) for (const id of ids) base.add(String(id));
		}
	}
	// project-entity person fields (header chips) resolve their user names too
	for (const f of projectFields) {
		if (f.type !== 'person') continue;
		for (const v of projectValues) {
			if (v.fieldId !== f.id) continue;
			const ids = decodeValue({ type: 'person' }, v.value);
			if (Array.isArray(ids)) for (const id of ids) base.add(String(id));
		}
	}
	return base;
}

/**
 * Project-entity rollup chip values (computed, never stored — aggregate a
 * target number field over all the project's tasks). Mirrors the custom-fields
 * page's projectRollupText so rollup fields can render as header chips. The two
 * `db.select` queries that produce `rollupTasks`/`rollupValues` stay in the load.
 *
 * `projRollups` is the already-filtered (`type === 'rollup'`) subset of
 * `projectFields` that the load uses to decide whether to run the queries at
 * all; `projectFields` (the FULL, unfiltered list) is also needed here because
 * the original inline code's target-field fallback searches the whole list,
 * not just the rollups — a rollup's `targetFieldId` could point at a plain
 * (non-rollup) project-entity field.
 */
export function computeProjectRollupText(
	projRollups: Field[],
	customFields: Field[],
	projectFields: Field[],
	rollupTasks: { id: string; parentId: string | null }[],
	rollupValues: { taskId: string; fieldId: string; value: string | null }[]
): Record<string, string> {
	const projectRollupText: Record<string, string> = {};
	const valueOf = (tid: string, fid: string) => {
		const raw = rollupValues.find((v) => v.taskId === tid && v.fieldId === fid)?.value;
		const n = raw == null ? null : Number(raw);
		return n != null && Number.isFinite(n) ? n : null;
	};
	for (const f of projRollups) {
		const cfg = { ...(f.config as unknown as RollupConfig), relation: 'task' as const };
		const n = computeTaskRollup(cfg, '', { tasks: rollupTasks, taskDeps: [], valueOf });
		const target =
			customFields.find((t) => t.id === cfg.targetFieldId) ??
			projectFields.find((t) => t.id === cfg.targetFieldId);
		projectRollupText[f.id] =
			target && cfg.formula !== 'count' ? formatNumber(n, target.config) : String(n);
	}
	return projectRollupText;
}
