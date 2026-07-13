import { eq } from 'drizzle-orm';
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

/** Create a user AND a membership in `orgId` in one step (the common fixture shape). */
export async function createMember(
	organizationId: string,
	role: 'owner' | 'admin' | 'member' = 'member',
	opts: { name?: string } = {}
): Promise<TestUser> {
	const u = await createUser({ name: opts.name });
	await createMembership(u.id, organizationId, role);
	return u;
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

/**
 * Grants `userId` edit access on a resource (`workspace` | `project` | `view` |
 * `task`). Stamps `organizationId` = the resource's org (ADR-062 invariant: grant
 * org == resource org) so org-filtered readers (grantedProjectIds/
 * accessibleWorkspaceIds) see it. Pass `organizationId` to override.
 */
export async function grantPermission(
	userId: string,
	resourceType: 'workspace' | 'project' | 'view' | 'task',
	resourceId: string,
	grantedBy: string,
	organizationId?: string | null
) {
	let orgId = organizationId ?? null;
	if (orgId === null) {
		if (resourceType === 'workspace') {
			const [w] = await db
				.select({ orgId: workspace.organizationId })
				.from(workspace)
				.where(eq(workspace.id, resourceId));
			orgId = w?.orgId ?? null;
		} else if (resourceType === 'project') {
			const [p] = await db
				.select({ orgId: workspace.organizationId })
				.from(project)
				.leftJoin(workspace, eq(project.workspaceId, workspace.id))
				.where(eq(project.id, resourceId));
			orgId = p?.orgId ?? null;
		}
	}
	const id = uid('perm');
	const now = new Date();
	await db.insert(permission).values({
		id,
		userId,
		resourceType,
		resourceId,
		organizationId: orgId,
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

/**
 * Full fixture: an org + its owner (a member of the org) + workspace + project +
 * built-in statuses. `admin` is an INSTANCE admin who is deliberately NOT a member
 * of the org — under ADR-062 it therefore has no data reach into the fixture.
 */
export async function seedProjectFixture() {
	const org = await createOrg();
	const admin = await createAdmin();
	const owner = await createUser({ name: 'Owner' });
	await createMembership(owner.id, org.id, 'member');
	const ws = await createWorkspace(owner.id, 'Test workspace', org.id);
	const proj = await createProject(ws.id, owner.id);
	const statuses = await ensureStatuses();
	return { org, admin, owner, ws, proj, statuses };
}
