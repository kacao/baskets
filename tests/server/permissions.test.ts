import { beforeEach, describe, expect, it } from 'vitest';
import { resetTables } from './isolationGuard';
import {
	accessibleWorkspaceIds,
	canAccessProject,
	canEditProject,
	canEditTask,
	canEditWorkspace,
	grantedProjectIds,
	isInstanceAdmin
} from '$lib/server/permissions';
import {
	createMember,
	createOrg,
	createProject,
	createUser,
	createWorkspace,
	grantPermission
} from './helpers/testDb';

beforeEach(resetTables);

// ADR-062 contract: tenant isolation is real. Membership in the resource's org is
// a PREREQUISITE for any access; org owners/admins see all of their org; a plain
// member with no grant sees nothing; an INSTANCE admin has NO implicit data reach;
// nothing crosses an org boundary.

describe('isInstanceAdmin', () => {
	it('is true only for user.role === "admin" (instance operator, not a tenant role)', () => {
		expect(isInstanceAdmin({ id: 'u1', role: 'admin' })).toBe(true);
		expect(isInstanceAdmin({ id: 'u1', role: 'member' })).toBe(false);
		expect(isInstanceAdmin({ id: 'u1', role: null })).toBe(false);
		expect(isInstanceAdmin(null)).toBe(false);
		expect(isInstanceAdmin(undefined)).toBe(false);
	});
});

describe('canAccessProject', () => {
	it('grants access to an org owner/admin of the project’s org', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);

		const orgAdmin = await createMember(org.id, 'admin');
		await expect(canAccessProject(orgAdmin, proj.id)).resolves.toBe(true);
	});

	it('grants access to the owning workspace owner (a member)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);

		await expect(canAccessProject(owner, proj.id)).resolves.toBe(true);
	});

	it('grants access to a member with a direct project grant', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const grantee = await createMember(org.id, 'member');
		await grantPermission(grantee.id, 'project', proj.id, owner.id);

		await expect(canAccessProject(grantee, proj.id)).resolves.toBe(true);
	});

	it('grants access to a member with a workspace grant on the project’s workspace', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const grantee = await createMember(org.id, 'member');
		await grantPermission(grantee.id, 'workspace', ws.id, owner.id);

		await expect(canAccessProject(grantee, proj.id)).resolves.toBe(true);
	});

	it('denies a plain member with no grant (membership alone confers no visibility)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const member = await createMember(org.id, 'member');

		await expect(canAccessProject(member, proj.id)).resolves.toBe(false);
	});

	it('denies an INSTANCE admin who is not a member of the org (no implicit data reach)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const instanceAdmin = await createUser({ role: 'admin' }); // NOT a member of `org`

		await expect(canAccessProject(instanceAdmin, proj.id)).resolves.toBe(false);
	});

	it('denies a user from a DIFFERENT org, even an org owner there (cross-org isolation)', async () => {
		const orgA = await createOrg('A');
		const ownerA = await createMember(orgA.id, 'member');
		const wsA = await createWorkspace(ownerA.id, 'WA', orgA.id);
		const projA = await createProject(wsA.id, ownerA.id);

		const orgB = await createOrg('B');
		const ownerB = await createMember(orgB.id, 'owner');

		await expect(canAccessProject(ownerB, projA.id)).resolves.toBe(false);
	});

	it('denies access for a missing project id and a null user', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);

		await expect(canAccessProject(owner, 'does-not-exist')).resolves.toBe(false);
		await expect(canAccessProject(null, proj.id)).resolves.toBe(false);
	});
});

describe('canEditTask (== canAccessProject)', () => {
	it('a project grantee can edit; a stranger cannot', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const grantee = await createMember(org.id, 'member');
		await grantPermission(grantee.id, 'project', proj.id, owner.id);
		const stranger = await createUser();

		const fakeTask = { id: 'task-1', parentId: null, projectId: proj.id };
		await expect(canEditTask(grantee, fakeTask)).resolves.toBe(true);
		await expect(canEditTask(stranger, fakeTask)).resolves.toBe(false);
	});
});

describe('canEditProject', () => {
	it('allows an org owner/admin, the workspace owner, and a project grantee', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const orgAdmin = await createMember(org.id, 'admin');
		const grantee = await createMember(org.id, 'member');
		await grantPermission(grantee.id, 'project', proj.id, owner.id);

		await expect(canEditProject(owner, proj.id)).resolves.toBe(true);
		await expect(canEditProject(orgAdmin, proj.id)).resolves.toBe(true);
		await expect(canEditProject(grantee, proj.id)).resolves.toBe(true);
	});

	it('denies a plain member, an out-of-org instance admin, and a stranger', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);
		const member = await createMember(org.id, 'member');
		const instanceAdmin = await createUser({ role: 'admin' });
		const stranger = await createUser();

		await expect(canEditProject(member, proj.id)).resolves.toBe(false);
		await expect(canEditProject(instanceAdmin, proj.id)).resolves.toBe(false);
		await expect(canEditProject(stranger, proj.id)).resolves.toBe(false);
	});
});

describe('canEditWorkspace', () => {
	it('allows an org owner/admin, the workspace owner, and a workspace grantee', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const orgAdmin = await createMember(org.id, 'admin');
		const grantee = await createMember(org.id, 'member');
		await grantPermission(grantee.id, 'workspace', ws.id, owner.id);

		await expect(canEditWorkspace(owner, ws.id)).resolves.toBe(true);
		await expect(canEditWorkspace(orgAdmin, ws.id)).resolves.toBe(true);
		await expect(canEditWorkspace(grantee, ws.id)).resolves.toBe(true);
	});

	it('denies a plain member, an out-of-org instance admin, and a stranger', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'member');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const member = await createMember(org.id, 'member');
		const instanceAdmin = await createUser({ role: 'admin' });
		const stranger = await createUser();

		await expect(canEditWorkspace(member, ws.id)).resolves.toBe(false);
		await expect(canEditWorkspace(instanceAdmin, ws.id)).resolves.toBe(false);
		await expect(canEditWorkspace(stranger, ws.id)).resolves.toBe(false);
	});
});

describe('accessibleWorkspaceIds / grantedProjectIds (org-scoped, no "all" sentinel)', () => {
	it('an org owner sees every workspace in the org, and nothing from another org', async () => {
		const orgA = await createOrg('A');
		const ownerA = await createMember(orgA.id, 'owner');
		const wsA1 = await createWorkspace(ownerA.id, 'A1', orgA.id);
		const otherA = await createMember(orgA.id, 'member');
		const wsA2 = await createWorkspace(otherA.id, 'A2', orgA.id);

		const orgB = await createOrg('B');
		const ownerB = await createMember(orgB.id, 'owner');
		await createWorkspace(ownerB.id, 'B1', orgB.id);

		const idsForA = await accessibleWorkspaceIds(ownerA, orgA.id);
		expect(idsForA.has(wsA1.id)).toBe(true);
		expect(idsForA.has(wsA2.id)).toBe(true);
		// asked about orgB (which ownerA does not belong to) → empty
		expect((await accessibleWorkspaceIds(ownerA, orgB.id)).size).toBe(0);
	});

	it('a plain member sees only owned + granted workspaces/projects, org-scoped', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);

		const member = await createMember(org.id, 'member');
		// no grants yet → sees nothing
		expect((await accessibleWorkspaceIds(member, org.id)).size).toBe(0);
		expect((await grantedProjectIds(member, org.id)).size).toBe(0);

		// a stamped project grant surfaces in this org, and NOT when asked about another
		await grantPermission(member.id, 'project', proj.id, owner.id);
		const grantedHere = await grantedProjectIds(member, org.id);
		expect(grantedHere.has(proj.id)).toBe(true);
		const otherOrg = await createOrg('other');
		expect((await grantedProjectIds(member, otherOrg.id)).size).toBe(0);
	});

	it('returns empty for a non-member and for a null org', async () => {
		const org = await createOrg();
		const stranger = await createUser();
		expect((await accessibleWorkspaceIds(stranger, org.id)).size).toBe(0);
		expect((await accessibleWorkspaceIds(stranger, null)).size).toBe(0);
	});
});
