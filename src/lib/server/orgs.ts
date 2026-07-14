import { and, asc, eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db, withTransaction } from './db';
import {
	integration,
	invitation,
	member,
	notification,
	organization,
	permission,
	user,
	workspace
} from './db/schema';
import { isFirstWorkspaceForUser, seedWorkspaceSamples } from './projects';
import { kickUser } from './realtime/hub';

/**
 * Options for the `org` (and server-written `workspace`) cookie. It MUST be
 * readable+writable by client JS: the sidebar org/workspace switchers set these
 * via `document.cookie`, and SvelteKit's `cookies.set` defaults to
 * `httpOnly: true` (+ `secure` in prod) — a server-set httpOnly cookie can never
 * be overridden by the switcher, silently breaking org switching. So mirror the
 * client-written semantics exactly (ADR-062 review fix).
 */
export const ORG_COOKIE_OPTS = {
	path: '/',
	maxAge: 60 * 60 * 24 * 365,
	sameSite: 'lax',
	httpOnly: false,
	secure: false
} as const;

/**
 * D4 auto-align: when a user opens an accessible project whose org isn't the
 * active one, switch the `org` cookie to the project's org (dropping the stale
 * `workspace` cookie). Client-writable cookie (ORG_COOKIE_OPTS) so the switcher
 * can still override it. NO redirect: redirecting to the SAME url that a load is
 * already navigating to trips SvelteKit's client-side redirect-loop guard (a hard
 * 500 on the first project click after login, when no `org` cookie exists yet).
 * The trade-off is one render of shell staleness (sidebar/switcher resolve the
 * previous org) ONLY on cross-org navigation — it self-heals on the next request
 * since the cookie is then correct. Same-org navigation (the common case) never
 * aligns, so never lags.
 */
export function alignActiveOrg(cookies: Cookies, projectOrgId: string | null) {
	if (!projectOrgId || cookies.get('org') === projectOrgId) return;
	cookies.set('org', projectOrgId, ORG_COOKIE_OPTS);
	cookies.delete('workspace', { path: '/' });
}

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
		// integration rows hold the Slack webhook secret — sweep them too (an org
		// with 0 workspaces can still hold a configured integration).
		await tx.delete(integration).where(eq(integration.organizationId, orgId));
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

// ---------------------------------------------------------------------------
// Membership + invitation services (ADR-062 D6/D8). The ONE code path for both
// the org-settings form actions (W3) and the REST endpoints (W4) — thin adapters
// only, per ADR-049. Gating follows ADR-019: a non-member actor gets 404
// (inaccessible ≡ missing); an accessible-but-underprivileged actor gets 403.
// The plugin's own /api/auth/organization/* endpoints remain live surface; their
// consistency is covered by the organizationHooks in auth.ts, and these services
// apply the same rules (owner protections, last-owner invariants, grant purges).
// ---------------------------------------------------------------------------

const INVITABLE_ROLES: OrgRole[] = ['member', 'admin'];
const INVITATION_TTL_MS = 604800 * 1000; // 7 days, matches the plugin config

async function ownerCount(orgId: string): Promise<number> {
	const rows = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.role, 'owner')));
	return rows.length;
}

/** 404 for non-members (org invisible), 403 for members below admin, role otherwise. */
async function requireOrgAdmin(
	actorId: string,
	orgId: string
): Promise<{ ok: true; role: OrgRole } | { ok: false; status: number; message: string }> {
	const role = await orgRole(actorId, orgId);
	if (!role) return { ok: false, status: 404, message: 'Not found' };
	if (role !== 'owner' && role !== 'admin')
		return { ok: false, status: 403, message: 'Requires organization admin' };
	return { ok: true, role };
}

/**
 * Invite by email (D6): creates a pending invitation row; the accept LINK
 * (/invite/<id>) is the capability — there is deliberately NO by-email discovery
 * surface while registration is email-unverified. Cancels prior pending invites
 * for the same email (mirrors cancelPendingInvitationsOnReInvite). Only
 * member/admin are invitable; ownership moves via updateMemberRoleService.
 */
export async function inviteMemberService(
	actorId: string,
	orgId: string,
	emailRaw: string,
	roleRaw?: string | null
): Promise<ServiceResult<{ id: string; email: string; role: OrgRole; expiresAt: Date }>> {
	const gate = await requireOrgAdmin(actorId, orgId);
	if (!gate.ok) return gate;

	const email = emailRaw.trim();
	if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		return { ok: false, status: 400, message: 'Invalid email address' };
	const role = (roleRaw?.trim() || 'member') as OrgRole;
	if (!INVITABLE_ROLES.includes(role))
		return { ok: false, status: 400, message: 'Role must be member or admin' };

	const members = await listMembers(orgId);
	if (members.some((m) => m.email.toLowerCase() === email.toLowerCase()))
		return { ok: false, status: 400, message: 'Already a member of this organization' };

	const now = new Date();
	const pending = await listPendingInvitations(orgId);
	for (const p of pending) {
		if (p.email.toLowerCase() === email.toLowerCase())
			await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, p.id));
	}

	const id = crypto.randomUUID();
	const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
	await db.insert(invitation).values({
		id,
		organizationId: orgId,
		email,
		role,
		status: 'pending',
		expiresAt,
		inviterId: actorId,
		createdAt: now
	});
	return { ok: true, data: { id, email, role, expiresAt } };
}

/** Cancel a pending invitation (org owner/admin; 404 hides other orgs' invites). */
export async function cancelInvitationService(
	actorId: string,
	invitationId: string
): Promise<ServiceResult<{ id: string }>> {
	const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
	if (!row) return { ok: false, status: 404, message: 'Not found' };
	const gate = await requireOrgAdmin(actorId, row.organizationId);
	if (!gate.ok)
		return gate.status === 403 ? gate : { ok: false, status: 404, message: 'Not found' };
	if (row.status !== 'pending')
		return { ok: false, status: 400, message: 'Invitation is no longer pending' };
	await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, invitationId));
	return { ok: true, data: { id: invitationId } };
}

/**
 * Resolve an invitation for the /invite/[id] page. The id IS the capability
 * (~UUID entropy, delivered out-of-band), so no auth gate — but only id-holders
 * ever see this, and it exposes just what the accept screen needs.
 */
export async function getInvitationForAccept(invitationId: string) {
	const [row] = await db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			status: invitation.status,
			expiresAt: invitation.expiresAt,
			orgId: invitation.organizationId,
			orgName: organization.name
		})
		.from(invitation)
		.innerJoin(organization, eq(invitation.organizationId, organization.id))
		.where(eq(invitation.id, invitationId));
	return row ?? null;
}

/**
 * Accept an invitation as the signed-in user (D6): pending + unexpired + the
 * session email must equal the invited email (case-insensitive — a speed bump,
 * not authentication, while registration is unverified; the link is the real
 * capability). Creates the membership (unique(orgId,userId) makes re-accepts
 * no-ops) and purges stale same-org grants so a re-joiner starts clean.
 */
export async function acceptInvitationService(
	user_: { id: string; email: string },
	invitationId: string
): Promise<ServiceResult<{ orgId: string }>> {
	const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
	if (!row) return { ok: false, status: 404, message: 'Not found' };
	if (row.status !== 'pending')
		return { ok: false, status: 400, message: 'Invitation is no longer valid' };
	if (row.expiresAt.getTime() < Date.now())
		return { ok: false, status: 400, message: 'Invitation has expired' };
	if (row.email.toLowerCase() !== user_.email.toLowerCase())
		return { ok: false, status: 403, message: 'This invitation is for a different email address' };

	const role: OrgRole = INVITABLE_ROLES.includes(row.role as OrgRole)
		? (row.role as OrgRole)
		: 'member';
	await db
		.insert(member)
		.values({
			id: crypto.randomUUID(),
			organizationId: row.organizationId,
			userId: user_.id,
			role,
			createdAt: new Date()
		})
		.onConflictDoNothing();
	await purgeStaleGrants(user_.id, row.organizationId);
	await db.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, invitationId));
	return { ok: true, data: { orgId: row.organizationId } };
}

/**
 * Remove a member (D8): org owner/admin; admins cannot remove owners; the last
 * owner is irremovable; self-removal goes through leaveOrgService (which owns the
 * last-owner rule for self). Purges the target's org grants and kicks their live
 * WS connections.
 */
export async function removeMemberService(
	actorId: string,
	orgId: string,
	targetUserId: string
): Promise<ServiceResult<{ userId: string }>> {
	const gate = await requireOrgAdmin(actorId, orgId);
	if (!gate.ok) return gate;
	if (actorId === targetUserId)
		return { ok: false, status: 400, message: 'Use “Leave organization” to remove yourself' };
	const targetRole = await orgRole(targetUserId, orgId);
	if (!targetRole) return { ok: false, status: 404, message: 'Member not found' };
	if (targetRole === 'owner') {
		if (gate.role !== 'owner')
			return { ok: false, status: 403, message: 'Only an owner can remove an owner' };
		if ((await ownerCount(orgId)) <= 1)
			return { ok: false, status: 400, message: 'Cannot remove the last owner' };
	}
	await db
		.delete(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, targetUserId)));
	await purgeStaleGrants(targetUserId, orgId);
	kickUser(targetUserId);
	return { ok: true, data: { userId: targetUserId } };
}

/**
 * Change a member's org role (D8, plugin-mirrored rules): only an owner may grant
 * or revoke the owner role; the last owner cannot be demoted; org admins may move
 * non-owners between member and admin.
 */
export async function updateMemberRoleService(
	actorId: string,
	orgId: string,
	targetUserId: string,
	newRoleRaw: string
): Promise<ServiceResult<{ userId: string; role: OrgRole }>> {
	const newRole = newRoleRaw as OrgRole;
	if (!['owner', 'admin', 'member'].includes(newRole))
		return { ok: false, status: 400, message: 'Invalid role' };
	const gate = await requireOrgAdmin(actorId, orgId);
	if (!gate.ok) return gate;
	const targetRole = await orgRole(targetUserId, orgId);
	if (!targetRole) return { ok: false, status: 404, message: 'Member not found' };
	if (targetRole === newRole) return { ok: true, data: { userId: targetUserId, role: newRole } };
	if ((newRole === 'owner' || targetRole === 'owner') && gate.role !== 'owner')
		return { ok: false, status: 403, message: 'Only an owner can change ownership' };
	if (targetRole === 'owner' && (await ownerCount(orgId)) <= 1)
		return { ok: false, status: 400, message: 'Cannot demote the last owner' };
	await db
		.update(member)
		.set({ role: newRole })
		.where(and(eq(member.organizationId, orgId), eq(member.userId, targetUserId)));
	return { ok: true, data: { userId: targetUserId, role: newRole } };
}

/**
 * Leave an org (D8): the last owner must transfer ownership or delete the org
 * first. Grants survive a self-leave but are inert (membership prerequisite) and
 * are purged on re-join.
 */
export async function leaveOrgService(
	userId: string,
	orgId: string
): Promise<ServiceResult<{ orgId: string }>> {
	const role = await orgRole(userId, orgId);
	if (!role) return { ok: false, status: 404, message: 'Not found' };
	if (role === 'owner' && (await ownerCount(orgId)) <= 1)
		return {
			ok: false,
			status: 400,
			message: 'Transfer ownership or delete the organization first'
		};
	await db.delete(member).where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
	kickUser(userId);
	return { ok: true, data: { orgId } };
}

/** Rename an org (owner/admin). The slug is intentionally left unchanged (v1). */
export async function updateOrganizationService(
	actorId: string,
	orgId: string,
	patch: { name?: string }
): Promise<ServiceResult<{ id: string }>> {
	const gate = await requireOrgAdmin(actorId, orgId);
	if (!gate.ok) return gate;
	if (patch.name !== undefined) {
		const name = patch.name.trim();
		if (!name) return { ok: false, status: 400, message: 'Organization name is required' };
		if (name.length > 120) return { ok: false, status: 400, message: 'Name too long (max 120)' };
		await db.update(organization).set({ name }).where(eq(organization.id, orgId));
	}
	return { ok: true, data: { id: orgId } };
}
