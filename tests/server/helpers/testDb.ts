import { db } from '$lib/server/db';
import {
	user,
	workspace,
	project,
	status,
	permission,
	organization,
	member
} from '$lib/server/db/schema.sqlite';
import { ensureDefaultStatuses } from '$lib/server/statuses';

/** The sentinel org planted by globalSetup — the default tenant for fixtures. */
export const SENTINEL_ORG_ID = '__ISO_SENTINEL_ORG__';

/** Fixture actor shape matching `Actor`/`SessionUser` across permissions.ts/tasks.ts. */
export type TestUser = { id: string; name: string; role: string | null };

let counter = 0;
function uid(prefix: string): string {
	counter += 1;
	return `${prefix}-${Date.now()}-${counter}`;
}

export async function createUser(
	opts: { role?: string | null; name?: string } = {}
): Promise<TestUser> {
	const id = uid('user');
	const now = new Date();
	await db.insert(user).values({
		id,
		name: opts.name ?? id,
		email: `${id}@example.invalid`,
		emailVerified: false,
		createdAt: now,
		updatedAt: now,
		role: opts.role ?? null
	});
	return { id, name: opts.name ?? id, role: opts.role ?? null };
}

export async function createAdmin(): Promise<TestUser> {
	return createUser({ role: 'admin' });
}

export async function createOrg(name = 'Test org') {
	const id = uid('org');
	const now = new Date();
	await db.insert(organization).values({ id, name, slug: id, createdAt: now });
	return { id, name };
}

export async function createMembership(
	userId: string,
	organizationId: string,
	role: 'owner' | 'admin' | 'member' = 'member'
) {
	const id = uid('member');
	const now = new Date();
	await db.insert(member).values({ id, organizationId, userId, role, createdAt: now });
	return { id, userId, organizationId, role };
}

export async function createWorkspace(
	ownerId: string,
	name = 'Test workspace',
	organizationId = SENTINEL_ORG_ID
) {
	const id = uid('ws');
	const now = new Date();
	await db
		.insert(workspace)
		.values({ id, name, ownerId, organizationId, createdAt: now, updatedAt: now });
	return { id, name, ownerId, organizationId };
}

export async function createProject(workspaceId: string, createdBy: string, name = 'Test project') {
	const id = uid('proj');
	const now = new Date();
	await db
		.insert(project)
		.values({ id, name, workspaceId, createdBy, createdAt: now, updatedAt: now });
	return { id, name, workspaceId, createdBy };
}

/** Grants `userId` edit access on a resource (`workspace` | `project` | `view` | `task`). */
export async function grantPermission(
	userId: string,
	resourceType: 'workspace' | 'project' | 'view' | 'task',
	resourceId: string,
	grantedBy: string
) {
	const id = uid('perm');
	const now = new Date();
	await db.insert(permission).values({
		id,
		userId,
		resourceType,
		resourceId,
		grantedBy,
		createdAt: now
	});
	return id;
}

/**
 * Ensures the 5 built-in app-wide statuses exist and returns them keyed by
 * category — `listProjectStatuses` falls back to these for any project with no
 * explicit `project_status` eligibility rows, so fixtures don't need to wire
 * per-project eligibility unless a test cares about it specifically.
 */
export async function ensureStatuses() {
	await ensureDefaultStatuses();
	const rows = await db.select().from(status);
	const byCategory = new Map(rows.map((r) => [r.category, r]));
	return {
		backlog: byCategory.get('backlog')!,
		planned: byCategory.get('planned')!,
		inProgress: byCategory.get('in-progress')!,
		completed: byCategory.get('completed')!,
		canceled: byCategory.get('canceled')!
	};
}

/** Full fixture: admin + owner + workspace + project + built-in statuses. */
export async function seedProjectFixture() {
	const admin = await createAdmin();
	const owner = await createUser({ name: 'Owner' });
	const ws = await createWorkspace(owner.id);
	const proj = await createProject(ws.id, owner.id);
	const statuses = await ensureStatuses();
	return { admin, owner, ws, proj, statuses };
}
