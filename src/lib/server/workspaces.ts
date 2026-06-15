import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { label, labelGroup, project, status, user, workspace } from './db/schema';

export const DEFAULT_WORKSPACE_ID = 'workspace-default';

let ensured = false;

/**
 * Idempotent bootstrap: guarantees a default workspace exists and adopts
 * pre-workspace rows into it (projects, custom app-wide statuses, labels,
 * label groups). Needs at least one user to own the workspace, so it retries
 * on every request until the first signup.
 */
export async function ensureDefaultWorkspace() {
	if (ensured) return;

	const existing = await db.select({ id: workspace.id }).from(workspace).limit(1);
	if (existing.length === 0) {
		let [owner] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.role, 'admin'))
			.limit(1);
		if (!owner)
			[owner] = await db
				.select({ id: user.id })
				.from(user)
				.orderBy(asc(user.createdAt))
				.limit(1);
		if (!owner) return; // no users yet — retry after first signup

		const now = new Date();
		await db
			.insert(workspace)
			.values({
				id: DEFAULT_WORKSPACE_ID,
				name: 'Default',
				ownerId: owner.id,
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoNothing();
	}

	const [adopter] = await db
		.select({ id: workspace.id })
		.from(workspace)
		.orderBy(asc(workspace.createdAt))
		.limit(1);
	if (adopter) {
		// pre-workspace rows: projects, labels, groups, and custom (non-built-in)
		// app-wide statuses move into the oldest workspace
		await db
			.update(project)
			.set({ workspaceId: adopter.id })
			.where(isNull(project.workspaceId));
		await db.update(label).set({ workspaceId: adopter.id }).where(isNull(label.workspaceId));
		await db
			.update(labelGroup)
			.set({ workspaceId: adopter.id })
			.where(isNull(labelGroup.workspaceId));
		await db
			.update(status)
			.set({ workspaceId: adopter.id })
			.where(
				and(isNull(status.workspaceId), isNull(status.projectId), eq(status.builtIn, false))
			);
	}

	ensured = true;
}

export async function listWorkspaces() {
	return db.select().from(workspace).orderBy(asc(workspace.name), asc(workspace.createdAt));
}

export async function getWorkspace(id: string) {
	const [w] = await db.select().from(workspace).where(eq(workspace.id, id));
	return w ?? null;
}
