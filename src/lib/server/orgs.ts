import { and, asc, eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db, withTransaction } from './db';
import {
	invitation,
	member,
	notification,
	organization,
	permission,
	user,
	workspace
} from './db/schema';
import { isFirstWorkspaceForUser, seedWorkspaceSamples } from './projects';

// Org service module (ADR-062). Primitives for the BetterAuth organization
// plugin: membership/role reads, active-org resolution (mirrors the `workspace`
// cookie resolver), slug generation, and the shared workspace-bootstrap code path
// used by BOTH the auth afterCreateOrganization hook and createOrganizationForUser
// so a plugin-created org and a directly-created org end up identical.
//
// Note the D3 membership-prerequisite access rules live in permissions.ts (W2);
// this module only supplies the reads/writes those guards build on.

export type OrgRole = 'owner' | 'admin' | 'member';

export type ServiceResult<T> =
	{ ok: true; data: T } | { ok: false; status: number; message: string };

type SessionUser = { id: string } | null | undefined;

/** Slug from an org name: lowercase, alphanumerics joined by single dashes. */
export function slugifyOrgName(name: string): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return base || 'org';
}

/**
 * Instance-wide-unique slug: appends -2, -3, … on collision. Server-generated
 * only (D1) — the client-supplied slug on the create endpoint is ignored.
 */
export async function uniqueOrgSlug(base: string): Promise<string> {
	const taken = new Set(
		(await db.select({ slug: organization.slug }).from(organization)).map((r) => r.slug)
	);
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Orgs the user belongs to, ordered by org createdAt (oldest first). */
export async function listUserOrgs(userId: string) {
	return db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			logo: organization.logo,
			createdAt: organization.createdAt
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(eq(member.userId, userId))
		.orderBy(asc(organization.createdAt));
}

/** The user's role in an org, or null when they are not a member. */
export async function orgRole(userId: string, orgId: string): Promise<OrgRole | null> {
	const [m] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
		.limit(1);
	return (m?.role as OrgRole | undefined) ?? null;
}

/** Owner or admin of the org. */
export async function isOrgAdmin(userId: string, orgId: string): Promise<boolean> {
	const role = await orgRole(userId, orgId);
	return role === 'owner' || role === 'admin';
}

/**
 * Active org for a browser request — mirrors the `workspace` cookie resolver:
 * reads the `org` cookie, validates it against the user's memberships, and
 * silently falls back to the first membership (by org createdAt). A forged/stale
 * cookie is treated as missing (no oracle). Returns null when the user has 0 orgs.
 */
export async function resolveActiveOrg(user: SessionUser, cookies: Cookies) {
	if (!user) return null;
	const orgs = await listUserOrgs(user.id);
	if (orgs.length === 0) return null;
	const requested = cookies.get('org');
	return orgs.find((o) => o.id === requested) ?? orgs[0];
}

export type OrgSummary = Awaited<ReturnType<typeof listUserOrgs>>[number];
export type ActiveOrgContext = {
	orgs: OrgSummary[];
	org: OrgSummary | null;
	orgId: string | null;
	role: OrgRole | null;
};

/**
 * The ONE shared org→workspace resolver for (app) loads (ADR-062 D4): resolves
 * the active org (via resolveActiveOrg's rule) PLUS the user's full org list and
 * their role in the active org. Callers then scope accessibleWorkspaceIds/
 * grantedProjectIds by `orgId` and resolve the `workspace` cookie within the org.
 * A 0-org user gets empty context (W3's layout redirects them to /onboarding).
 */
export async function resolveActiveOrgContext(
	user: SessionUser,
	cookies: Cookies
): Promise<ActiveOrgContext> {
	if (!user) return { orgs: [], org: null, orgId: null, role: null };
	const orgs = await listUserOrgs(user.id);
	if (orgs.length === 0) return { orgs, org: null, orgId: null, role: null };
	const requested = cookies.get('org');
	const org = orgs.find((o) => o.id === requested) ?? orgs[0];
	const role = await orgRole(user.id, org.id);
	return { orgs, org, orgId: org.id, role };
}

/**
 * Create a workspace in an org (ADR-062) — the ONE service path for both the form
 * action and REST. Requires the owner to be a member of `organizationId` (identical
 * error for a nonexistent vs out-of-org id — no oracle), enforces per-org name
 * uniqueness, stamps organizationId, and seeds sample content when this is the
 * user's first owned workspace anywhere.
 */
export async function createWorkspaceService(opts: {
	name: string;
	ownerId: string;
	organizationId: string;
}): Promise<ServiceResult<{ id: string }>> {
	const name = opts.name.trim();
	if (!name) return { ok: false, status: 400, message: 'Workspace name is required' };
	if (name.length > 120) return { ok: false, status: 400, message: 'Name too long (max 120)' };

	// membership is the prerequisite; a nonexistent org and a non-member org both
	// resolve to a null role, so they share one error (no existence oracle).
	const role = await orgRole(opts.ownerId, opts.organizationId);
	if (!role) return { ok: false, status: 400, message: 'Unknown organization' };

	const existing = await db
		.select({ name: workspace.name })
		.from(workspace)
		.where(eq(workspace.organizationId, opts.organizationId));
	if (existing.some((w) => w.name.toLowerCase() === name.toLowerCase()))
		return { ok: false, status: 400, message: 'A workspace with that name already exists' };

	const seedSamples = await isFirstWorkspaceForUser(opts.ownerId);
	const id = crypto.randomUUID();
	const now = new Date();
	await db.insert(workspace).values({
		id,
		name,
		ownerId: opts.ownerId,
		organizationId: opts.organizationId,
		createdAt: now,
		updatedAt: now
	});
	if (seedSamples) await seedWorkspaceSamples(id, { id: opts.ownerId });
	return { ok: true, data: { id } };
}

/**
 * Delete a user's permission rows in an org. Called when a member is removed or
 * re-joins so a departed user's grants never silently resurrect (ADR-062 D1).
 * Best-effort — swallow errors when fire-and-forget.
 */
export async function purgeStaleGrants(userId: string, orgId: string): Promise<void> {
	try {
		await db
			.delete(permission)
			.where(and(eq(permission.userId, userId), eq(permission.organizationId, orgId)));
	} catch (e) {
		console.error('[orgs] purgeStaleGrants failed', e);
	}
}

/** True when the user owns exactly one org (i.e. this is their first owned org). */
async function ownsExactlyOneOrg(userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.userId, userId), eq(member.role, 'owner')));
	return rows.length === 1;
}

/**
 * Shared workspace-bootstrap for a freshly-created org. Idempotent (skips if the
 * org already has a workspace) and used by BOTH the afterCreateOrganization hook
 * and createOrganizationForUser so both paths produce an identical end state:
 * a "Workspace" owned by the creator, plus sample content for a first-time owner.
 */
export async function bootstrapOrgWorkspace(
	orgId: string,
	ownerId: string,
	opts: { seedSamples: boolean }
): Promise<string> {
	const [existing] = await db
		.select({ id: workspace.id })
		.from(workspace)
		.where(eq(workspace.organizationId, orgId))
		.limit(1);
	if (existing) return existing.id;

	const wsId = crypto.randomUUID();
	const now = new Date();
	await db.insert(workspace).values({
		id: wsId,
		name: 'Workspace',
		ownerId,
		organizationId: orgId,
		createdAt: now,
		updatedAt: now
	});

	if (opts.seedSamples) {
		await seedWorkspaceSamples(wsId, { id: ownerId });
	}
	return wsId;
}

/** True when this org is the user's first owned org (drives sample seeding). */
export async function shouldSeedSamplesForOwner(userId: string): Promise<boolean> {
	return ownsExactlyOneOrg(userId);
}

/**
 * Programmatic org creation (tests, admin flows) — the direct-insert twin of the
 * plugin's create endpoint. Inserts the org + an owner membership, then runs the
 * SAME bootstrap as the afterCreateOrganization hook.
 */
export async function createOrganizationForUser(userId: string, name: string): Promise<string> {
	const now = new Date();
	const orgId = crypto.randomUUID();
	const slug = await uniqueOrgSlug(slugifyOrgName(name));
	await db.insert(organization).values({ id: orgId, name, slug, createdAt: now });
	await db
		.insert(member)
		.values({
			id: crypto.randomUUID(),
			organizationId: orgId,
			userId,
			role: 'owner',
			createdAt: now
		})
		.onConflictDoNothing();
	const seedSamples = await ownsExactlyOneOrg(userId);
	await bootstrapOrgWorkspace(orgId, userId, { seedSamples });
	return orgId;
}

/**
 * Guarded org deletion (D8) — the plugin's own deletion is disabled. Owner only,
 * and only when the org has 0 workspaces. One transaction sweeps invitation,
 * member, org-scoped permission + notification rows, then the org (org columns
 * carry no real FK on sqlite, so cascades can't be relied on).
 */
export async function deleteOrganizationGuarded(
	orgId: string,
	userId: string
): Promise<ServiceResult<{ id: string }>> {
	const role = await orgRole(userId, orgId);
	// ADR-019: a non-member must not be able to tell a real org from a missing one.
	if (!role) return { ok: false, status: 404, message: 'Organization not found' };
	if (role !== 'owner') {
		return { ok: false, status: 403, message: 'Only the organization owner can delete it' };
	}
	const [ws] = await db
		.select({ id: workspace.id })
		.from(workspace)
		.where(eq(workspace.organizationId, orgId))
		.limit(1);
	if (ws) {
		return {
			ok: false,
			status: 400,
			message: 'Delete all workspaces before deleting the organization'
		};
	}
	await withTransaction(async (tx) => {
		await tx.delete(invitation).where(eq(invitation.organizationId, orgId));
		await tx.delete(member).where(eq(member.organizationId, orgId));
		await tx.delete(permission).where(eq(permission.organizationId, orgId));
		await tx.delete(notification).where(eq(notification.organizationId, orgId));
		await tx.delete(organization).where(eq(organization.id, orgId));
	});
	return { ok: true, data: { id: orgId } };
}

/** Members of an org with their user profile, oldest first. */
export async function listMembers(orgId: string) {
	return db
		.select({
			id: member.id,
			userId: member.userId,
			role: member.role,
			createdAt: member.createdAt,
			name: user.name,
			email: user.email
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, orgId))
		.orderBy(asc(member.createdAt));
}

/** Pending invitations for an org, newest first. */
export async function listPendingInvitations(orgId: string) {
	return db
		.select()
		.from(invitation)
		.where(and(eq(invitation.organizationId, orgId), eq(invitation.status, 'pending')))
		.orderBy(asc(invitation.createdAt));
}
