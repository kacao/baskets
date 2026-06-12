import { db } from './db';
import { permission, project, projectStatus, view } from './db/schema';
import { listStatuses } from './statuses';

export const VIEW_TYPES = ['dashboard', 'table', 'board', 'list', 'map'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/**
 * Creates a project with its invariants:
 * - at least one view (default "Table")
 * - all current app statuses eligible
 * - non-admin creators get an edit grant on their own project
 */
export async function createProjectWithDefaults(opts: {
	name: string;
	description: string | null;
	creator: { id: string; role?: string | null };
}) {
	const id = crypto.randomUUID();
	const now = new Date();

	await db.insert(project).values({
		id,
		name: opts.name,
		description: opts.description,
		createdBy: opts.creator.id,
		createdAt: now,
		updatedAt: now
	});

	await db.insert(view).values({
		id: crypto.randomUUID(),
		projectId: id,
		name: 'Table',
		type: 'table',
		config: '{}',
		position: 0,
		isDefault: true,
		createdBy: opts.creator.id,
		createdAt: now,
		updatedAt: now
	});

	const statuses = await listStatuses();
	if (statuses.length > 0) {
		await db
			.insert(projectStatus)
			.values(statuses.map((s) => ({ projectId: id, statusId: s.id })));
	}

	if (opts.creator.role !== 'admin') {
		await db.insert(permission).values({
			id: crypto.randomUUID(),
			userId: opts.creator.id,
			resourceType: 'project',
			resourceId: id,
			grantedBy: opts.creator.id,
			createdAt: now
		});
	}

	return id;
}
