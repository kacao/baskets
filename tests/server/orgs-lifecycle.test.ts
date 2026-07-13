import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetTables } from './isolationGuard';
import {
	createMember,
	createOrg,
	createUser,
	createWorkspace,
	grantPermission,
	insertNotification
} from './helpers/testDb';
import { db } from '$lib/server/db';
import {
	invitation,
	member,
	organization,
	permission,
	notification,
	workspace
} from '$lib/server/db/schema.sqlite';
import { createWorkspaceService, deleteOrganizationGuarded } from '$lib/server/orgs';

beforeEach(resetTables);

// ADR-062 D8 — guarded org deletion (owner-only, empty-only) + the single
// workspace-creation service (per-org membership + name uniqueness + org stamp).

describe('deleteOrganizationGuarded (A6)', () => {
	it('a non-member gets 404 (org invisible), a non-owner member gets 403 (owner-only)', async () => {
		const org = await createOrg();
		await createMember(org.id, 'owner');
		const plain = await createMember(org.id, 'member');
		const outsider = await createUser();

		const asOutsider = await deleteOrganizationGuarded(org.id, outsider.id);
		expect(asOutsider.ok).toBe(false);
		if (!asOutsider.ok) expect(asOutsider.status).toBe(404);

		const asPlain = await deleteOrganizationGuarded(org.id, plain.id);
		expect(asPlain.ok).toBe(false);
		if (!asPlain.ok) expect(asPlain.status).toBe(403);
	});

	it('refuses to delete an org that still has a workspace (400)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		await createWorkspace(owner.id, 'W', org.id);

		const res = await deleteOrganizationGuarded(org.id, owner.id);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.status).toBe(400);
	});

	it('owner deletes an empty org and the sweep removes invitation/member/permission/notification rows', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const other = await createMember(org.id, 'member');

		// org-scoped satellite rows (no workspace, so the org is deletable)
		await db.insert(invitation).values({
			id: 'inv-sweep',
			organizationId: org.id,
			email: 'x@example.invalid',
			role: 'member',
			status: 'pending',
			expiresAt: new Date(Date.now() + 60_000),
			inviterId: owner.id,
			createdAt: new Date()
		});
		await grantPermission(other.id, 'project', 'some-proj', owner.id, org.id);
		await insertNotification({ userId: owner.id, organizationId: org.id, projectId: null });

		const res = await deleteOrganizationGuarded(org.id, owner.id);
		expect(res.ok).toBe(true);

		expect(await db.select().from(organization).where(eq(organization.id, org.id))).toHaveLength(0);
		expect(await db.select().from(member).where(eq(member.organizationId, org.id))).toHaveLength(0);
		expect(
			await db.select().from(invitation).where(eq(invitation.organizationId, org.id))
		).toHaveLength(0);
		expect(
			await db.select().from(permission).where(eq(permission.organizationId, org.id))
		).toHaveLength(0);
		expect(
			await db.select().from(notification).where(eq(notification.organizationId, org.id))
		).toHaveLength(0);
	});
});

describe('createWorkspaceService (A7)', () => {
	it('a non-member org id and a bogus org id share ONE error (400 Unknown organization — no oracle)', async () => {
		const org = await createOrg();
		await createMember(org.id, 'owner');
		const outsider = await createUser();

		const nonMember = await createWorkspaceService({
			name: 'WS',
			ownerId: outsider.id,
			organizationId: org.id
		});
		expect(nonMember.ok).toBe(false);
		const bogus = await createWorkspaceService({
			name: 'WS',
			ownerId: outsider.id,
			organizationId: 'org-does-not-exist'
		});
		expect(bogus.ok).toBe(false);
		if (!nonMember.ok && !bogus.ok) {
			expect(nonMember.status).toBe(400);
			expect(bogus.status).toBe(400);
			expect(nonMember.message).toBe(bogus.message); // identical shape — no existence oracle
		}
	});

	it('stamps organizationId on the created workspace', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const res = await createWorkspaceService({
			name: 'Alpha',
			ownerId: owner.id,
			organizationId: org.id
		});
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const [ws] = await db.select().from(workspace).where(eq(workspace.id, res.data.id));
		expect(ws.organizationId).toBe(org.id);
		expect(ws.ownerId).toBe(owner.id);
	});

	it('enforces per-ORG name uniqueness: dup in the same org 400s, same name in another org is OK', async () => {
		const orgA = await createOrg('A');
		const ownerA = await createMember(orgA.id, 'owner');
		const orgB = await createOrg('B');
		const ownerB = await createMember(orgB.id, 'owner');

		expect(
			(
				await createWorkspaceService({
					name: 'Shared',
					ownerId: ownerA.id,
					organizationId: orgA.id
				})
			).ok
		).toBe(true);

		const dup = await createWorkspaceService({
			name: 'Shared',
			ownerId: ownerA.id,
			organizationId: orgA.id
		});
		expect(dup.ok).toBe(false);
		if (!dup.ok) expect(dup.status).toBe(400);

		// case-insensitive within the org
		const dupCase = await createWorkspaceService({
			name: 'shared',
			ownerId: ownerA.id,
			organizationId: orgA.id
		});
		expect(dupCase.ok).toBe(false);

		// same name in a DIFFERENT org is allowed (uniqueness is per-org)
		const crossOrg = await createWorkspaceService({
			name: 'Shared',
			ownerId: ownerB.id,
			organizationId: orgB.id
		});
		expect(crossOrg.ok).toBe(true);
	});
});
