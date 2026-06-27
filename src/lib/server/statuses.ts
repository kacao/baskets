import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { projectStatus, status } from './db/schema';
import { STATUS_CATEGORIES, type StatusCategory } from '$lib/statuses';

export { STATUS_CATEGORIES, type StatusCategory };

const DEFAULT_STATUSES: {
	id: string;
	name: string;
	category: StatusCategory;
	color: string;
	icon: string;
}[] = [
	{ id: 'status-backlog', name: 'Backlog', category: 'backlog', color: '#71717a', icon: 'iconoir:circle' },
	{ id: 'status-planned', name: 'Planned', category: 'planned', color: '#3b82f6', icon: 'iconoir:clock' },
	{ id: 'status-in-progress', name: 'In progress', category: 'in-progress', color: '#f59e0b', icon: 'iconoir:half-moon' },
	{ id: 'status-completed', name: 'Completed', category: 'completed', color: '#16a34a', icon: 'iconoir:check-circle' },
	{ id: 'status-canceled', name: 'Canceled', category: 'canceled', color: '#a1a1aa', icon: 'iconoir:xmark-circle' }
];

let ensured = false;

/** Idempotent bootstrap: guarantees the five built-in statuses exist (with colors). */
export async function ensureDefaultStatuses() {
	if (ensured) return;
	const existing = await db
		.select({
			id: status.id,
			name: status.name,
			category: status.category,
			color: status.color,
			icon: status.icon
		})
		.from(status);
	const have = new Map(existing.map((s) => [s.id, s]));
	const now = new Date();
	const missing = DEFAULT_STATUSES.filter((s) => !have.has(s.id));
	if (missing.length > 0) {
		await db.insert(status).values(
			missing.map((s) => ({
				...s,
				position: DEFAULT_STATUSES.indexOf(s) * 10,
				builtIn: true,
				createdAt: now
			}))
		);
	}
	// reconcile name/category/color/icon on pre-existing built-ins (migrates older
	// rows: 4-category set + missing default icons)
	for (const s of DEFAULT_STATUSES) {
		const row = have.get(s.id);
		if (
			row &&
			(row.name !== s.name ||
				row.category !== s.category ||
				row.color !== s.color ||
				(!row.icon && s.icon))
		)
			await db
				.update(status)
				.set({ name: s.name, category: s.category, color: s.color, icon: row.icon || s.icon })
				.where(eq(status.id, s.id));
	}
	ensured = true;
}

/**
 * App-wide default statuses: the five built-ins. Fixed — no add/edit/remove
 * (custom statuses live on a workspace or a project).
 */
export async function listStatuses() {
	return db
		.select()
		.from(status)
		.where(and(isNull(status.projectId), isNull(status.workspaceId)))
		.orderBy(asc(status.position), asc(status.createdAt));
}

/** Statuses owned by one workspace. */
export async function listWorkspaceStatuses(workspaceId: string) {
	return db
		.select()
		.from(status)
		.where(eq(status.workspaceId, workspaceId))
		.orderBy(asc(status.position), asc(status.createdAt));
}

/** Statuses owned by one project. */
export async function listProjectCustomStatuses(projectId: string) {
	return db
		.select()
		.from(status)
		.where(eq(status.projectId, projectId))
		.orderBy(asc(status.position), asc(status.createdAt));
}

/** Statuses a project allows, in global order. Falls back to all if none configured. */
export async function listProjectStatuses(projectId: string) {
	const rows = await db
		.select({ status })
		.from(projectStatus)
		.innerJoin(status, eq(projectStatus.statusId, status.id))
		.where(eq(projectStatus.projectId, projectId))
		.orderBy(asc(status.position), asc(status.createdAt));

	if (rows.length > 0) return rows.map((r) => r.status);
	return listStatuses();
}
