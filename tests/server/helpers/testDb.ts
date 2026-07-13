import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	user,
	workspace,
	project,
	status,
	permission,
	organization,
	member,
	view,
	integration,
	notification
} from '$lib/server/db/schema.sqlite';
import { ensureDefaultStatuses } from '$lib/server/statuses';

/** The sentinel org planted by globalSetup — the default tenant for fixtures. */
export const SENTINEL_ORG_ID = '__ISO_SENTINEL_ORG__';

/** Fixture actor shape matching `Actor`/`SessionUser` across permissions.ts/tasks.ts. */
export type TestUser = { id: string; name: string; email: string; role: string | null };

let counter = 0;
function uid(prefix: string): string {
	counter += 1;
	return `${prefix}-${Date.now()}-${counter}`;
}

export async function createUser(
	opts: { role?: string | null; name?: string } = {}
): Promise<TestUser> {
	const id = uid('user');
	const email = `${id}@example.invalid`;
	const now = new Date();
	await db.insert(user).values({
		id,
		name: opts.name ?? id,
		email,
		emailVerified: false,
		createdAt: now,
		updatedAt: now,
		role: opts.role ?? null
	});
	return { id, name: opts.name ?? id, email, role: opts.role ?? null };
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

export async function createView(projectId: string, createdBy: string, name = 'Table') {
	const id = uid('view');
	const now = new Date();
	await db
		.insert(view)
		.values({ id, projectId, name, type: 'table', createdBy, createdAt: now, updatedAt: now });
	return { id, name, projectId };
}

/** A Slack integration row for an org (composite unique is per (org, type)). */
export async function createIntegration(
	organizationId: string,
	createdBy: string,
	config: Record<string, unknown>,
	enabled = true
) {
	const id = uid('integration');
	const now = new Date();
	await db.insert(integration).values({
		id,
		type: 'slack',
		organizationId,
		enabled,
		config: JSON.stringify(config),
		createdBy,
		createdAt: now,
		updatedAt: now
	});
	return { id, organizationId };
}

/** Insert a notification row directly (org is required in code; stamp it explicitly). */
export async function insertNotification(opts: {
	userId: string;
	organizationId: string;
	projectId?: string | null;
	taskId?: string | null;
	type?: string;
	body?: string;
	read?: boolean;
}) {
	const id = uid('notif');
	const now = new Date();
	await db.insert(notification).values({
		id,
		userId: opts.userId,
		type: opts.type ?? 'mention',
		body: opts.body ?? 'hello',
		organizationId: opts.organizationId,
		projectId: opts.projectId ?? null,
		taskId: opts.taskId ?? null,
		read: opts.read ?? false,
		createdAt: now
	});
	return { id };
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

/**
 * Two fully-populated organizations for cross-org isolation tests (ADR-062 W5).
 *
 *   orgA: ownerA (owner), adminA (admin), memberAGrant (member + a direct project
 *         grant on projA), memberAPlain (member, NO grants); a workspace wsA owned
 *         by ownerA, a project projA, and a view viewA.
 *   orgB: ownerB (owner) + a workspace wsB, project projB, view viewB.
 *
 * Plus two org-less outsiders: `instanceAdmin` (user.role === 'admin' but a member
 * of NO org — the D3 headline: no implicit tenant reach) and `stranger` (a plain
 * signed-in user in no org). Everything in orgA must be invisible to orgB users,
 * the instance admin, and the stranger — and vice versa.
 */
export async function seedTwoOrgFixture() {
	const orgA = await createOrg('Org A');
	const orgB = await createOrg('Org B');

	const ownerA = await createMember(orgA.id, 'owner', { name: 'ownerA' });
	const adminA = await createMember(orgA.id, 'admin', { name: 'adminA' });
	const memberAGrant = await createMember(orgA.id, 'member', { name: 'memberAGrant' });
	const memberAPlain = await createMember(orgA.id, 'member', { name: 'memberAPlain' });

	const ownerB = await createMember(orgB.id, 'owner', { name: 'ownerB' });

	const wsA = await createWorkspace(ownerA.id, 'WS A', orgA.id);
	const projA = await createProject(wsA.id, ownerA.id, 'Proj A');
	const viewA = await createView(projA.id, ownerA.id, 'Table A');
	await grantPermission(memberAGrant.id, 'project', projA.id, ownerA.id);

	const wsB = await createWorkspace(ownerB.id, 'WS B', orgB.id);
	const projB = await createProject(wsB.id, ownerB.id, 'Proj B');
	const viewB = await createView(projB.id, ownerB.id, 'Table B');

	const instanceAdmin = await createUser({ role: 'admin', name: 'instanceAdmin' });
	const stranger = await createUser({ name: 'stranger' });

	const statuses = await ensureStatuses();
	return {
		orgA,
		orgB,
		ownerA,
		adminA,
		memberAGrant,
		memberAPlain,
		ownerB,
		wsA,
		projA,
		viewA,
		wsB,
		projB,
		viewB,
		instanceAdmin,
		stranger,
		statuses
	};
}
