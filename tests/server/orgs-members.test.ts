import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { resetTables } from './isolationGuard';
import {
	createMember,
	createOrg,
	createProject,
	createUser,
	createWorkspace,
	grantPermission
} from './helpers/testDb';
import { db } from '$lib/server/db';
import { invitation, permission } from '$lib/server/db/schema.sqlite';
import { canAccessProject } from '$lib/server/permissions';
import {
	acceptInvitationService,
	leaveOrgService,
	orgRole,
	removeMemberService,
	updateMemberRoleService
} from '$lib/server/orgs';

beforeEach(resetTables);

// ADR-062 D8 — member lifecycle (owner protections, last-owner invariants) AND
// the grant-inertness guarantees of D1/D3: a departed member's grants must never
// silently confer access afterward (purged on remove / re-join; inert on leave).

describe('removeMemberService (A5)', () => {
	it('an admin cannot remove an owner (403); an owner can remove a member', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const admin = await createMember(org.id, 'admin');
		const victim = await createMember(org.id, 'member');

		const adminRemovesOwner = await removeMemberService(admin.id, org.id, owner.id);
		expect(adminRemovesOwner.ok).toBe(false);
		if (!adminRemovesOwner.ok) expect(adminRemovesOwner.status).toBe(403);

		const ownerRemovesMember = await removeMemberService(owner.id, org.id, victim.id);
		expect(ownerRemovesMember.ok).toBe(true);
		expect(await orgRole(victim.id, org.id)).toBeNull();
	});

	it('the last owner is irremovable, and self-removal is rejected (use Leave)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const other = await createMember(org.id, 'owner'); // a second owner

		// remove `other` so `owner` is the last; then owner-removes-owner must 400
		expect((await removeMemberService(owner.id, org.id, other.id)).ok).toBe(true);
		const self = await removeMemberService(owner.id, org.id, owner.id);
		expect(self.ok).toBe(false);
		if (!self.ok) expect(self.status).toBe(400); // self-removal → 400 (use leave)
	});

	it('removing a non-member target → 404 (member not found)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const outsider = await createUser();
		const res = await removeMemberService(owner.id, org.id, outsider.id);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.status).toBe(404);
	});

	it('purges the removed member’s org grants — access goes inert immediately (A3)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const grantee = await createMember(org.id, 'member');
		await grantPermission(grantee.id, 'project', proj.id, owner.id);
		// precondition: the grant currently works
		await expect(canAccessProject(grantee, proj.id)).resolves.toBe(true);

		const res = await removeMemberService(owner.id, org.id, grantee.id);
		expect(res.ok).toBe(true);

		const grants = await db.select().from(permission).where(eq(permission.userId, grantee.id));
		expect(grants).toHaveLength(0);
		await expect(canAccessProject(grantee, proj.id)).resolves.toBe(false);
	});
});

describe('updateMemberRoleService (A5)', () => {
	it('only an owner may grant/revoke ownership; an admin cannot', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const admin = await createMember(org.id, 'admin');
		const target = await createMember(org.id, 'member');

		const adminPromotesToOwner = await updateMemberRoleService(
			admin.id,
			org.id,
			target.id,
			'owner'
		);
		expect(adminPromotesToOwner.ok).toBe(false);
		if (!adminPromotesToOwner.ok) expect(adminPromotesToOwner.status).toBe(403);

		const ownerPromotes = await updateMemberRoleService(owner.id, org.id, target.id, 'owner');
		expect(ownerPromotes.ok).toBe(true);
		expect(await orgRole(target.id, org.id)).toBe('owner');
	});

	it('an admin may move a non-owner between member and admin', async () => {
		const org = await createOrg();
		await createMember(org.id, 'owner');
		const admin = await createMember(org.id, 'admin');
		const target = await createMember(org.id, 'member');

		const promote = await updateMemberRoleService(admin.id, org.id, target.id, 'admin');
		expect(promote.ok).toBe(true);
		expect(await orgRole(target.id, org.id)).toBe('admin');
	});

	it('the last owner cannot be demoted (400)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const res = await updateMemberRoleService(owner.id, org.id, owner.id, 'admin');
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.status).toBe(400);
		expect(await orgRole(owner.id, org.id)).toBe('owner');
	});
});

describe('leaveOrgService (A5 + A3)', () => {
	it('the last owner cannot leave (400) — must transfer or delete first', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const res = await leaveOrgService(owner.id, org.id);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.status).toBe(400);
		expect(await orgRole(owner.id, org.id)).toBe('owner');
	});

	it('a member may leave; their grants SURVIVE the row but are INERT (membership prerequisite)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const leaver = await createMember(org.id, 'member');
		await grantPermission(leaver.id, 'project', proj.id, owner.id);
		await expect(canAccessProject(leaver, proj.id)).resolves.toBe(true);

		const res = await leaveOrgService(leaver.id, org.id);
		expect(res.ok).toBe(true);
		expect(await orgRole(leaver.id, org.id)).toBeNull();

		// D8: leave does NOT purge grants (unlike remove) — the row is still there…
		const grants = await db.select().from(permission).where(eq(permission.userId, leaver.id));
		expect(grants).toHaveLength(1);
		// …but it is INERT: without membership the guard returns false.
		await expect(canAccessProject(leaver, proj.id)).resolves.toBe(false);
	});

	it('re-accepting an invitation purges the leaver’s stale grants so access does NOT resurrect (A3)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const rejoiner = await createMember(org.id, 'member');
		await grantPermission(rejoiner.id, 'project', proj.id, owner.id);

		// leave (grant survives, inert)
		expect((await leaveOrgService(rejoiner.id, org.id)).ok).toBe(true);
		expect(
			(await db.select().from(permission).where(eq(permission.userId, rejoiner.id))).length
		).toBe(1);

		// re-join via an accepted invitation → purgeStaleGrants runs
		const invId = `inv-${Math.random().toString(36).slice(2)}`;
		await db.insert(invitation).values({
			id: invId,
			organizationId: org.id,
			email: rejoiner.email,
			role: 'member',
			status: 'pending',
			expiresAt: new Date(Date.now() + 60_000),
			inviterId: owner.id,
			createdAt: new Date()
		});
		const accepted = await acceptInvitationService(
			{ id: rejoiner.id, email: rejoiner.email },
			invId
		);
		expect(accepted.ok).toBe(true);
		expect(await orgRole(rejoiner.id, org.id)).toBe('member');

		// the stale grant is gone → the re-joiner starts clean (no resurrected access)
		const grants = await db
			.select()
			.from(permission)
			.where(and(eq(permission.userId, rejoiner.id), eq(permission.organizationId, org.id)));
		expect(grants).toHaveLength(0);
		await expect(canAccessProject(rejoiner, proj.id)).resolves.toBe(false);
	});
});
