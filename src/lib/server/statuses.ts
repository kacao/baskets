import { asc, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { projectStatus, status } from './db/schema';

export const STATUS_CATEGORIES = ['todo', 'active', 'done', 'canceled'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

const DEFAULT_STATUSES: { id: string; name: string; category: StatusCategory }[] = [
	{ id: 'status-backlog', name: 'Backlog', category: 'todo' },
	{ id: 'status-planned', name: 'Planned', category: 'todo' },
	{ id: 'status-in-progress', name: 'In progress', category: 'active' },
	{ id: 'status-completed', name: 'Completed', category: 'done' },
	{ id: 'status-canceled', name: 'Canceled', category: 'canceled' }
];

export const DEFAULT_STATUS_ID = 'status-backlog';

let ensured = false;

/** Idempotent bootstrap: guarantees the five built-in statuses exist. */
export async function ensureDefaultStatuses() {
	if (ensured) return;
	const existing = await db.select({ id: status.id }).from(status);
	const have = new Set(existing.map((s) => s.id));
	const now = new Date();
	const missing = DEFAULT_STATUSES.filter((s) => !have.has(s.id));
	if (missing.length > 0) {
		await db.insert(status).values(
			missing.map((s, i) => ({
				...s,
				position: DEFAULT_STATUSES.indexOf(s) * 10,
				builtIn: true,
				createdAt: now
			}))
		);
	}
	ensured = true;
}

/** App-wide statuses only (project-scoped ones live with their project). */
export async function listStatuses() {
	return db
		.select()
		.from(status)
		.where(isNull(status.projectId))
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
