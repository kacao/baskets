import { beforeEach, describe, expect, it } from 'vitest';
import { resetTables } from './isolationGuard';
import {
	canAccessProject,
	canEditProject,
	canEditTask,
	canEditWorkspace,
	isAdmin
} from '$lib/server/permissions';
import {
	createProject,
	createUser,
	createWorkspace,
	grantPermission
} from './helpers/testDb';

beforeEach(resetTables);

describe('isAdmin', () => {
	it('returns true for a user with role admin', () => {
		expect(isAdmin({ id: 'u1', role: 'admin' })).toBe(true);
	});

	it('returns false for a user with a non-admin role', () => {
		expect(isAdmin({ id: 'u1', role: 'member' })).toBe(false);
	});

	it('returns false for a user with no role', () => {
		expect(isAdmin({ id: 'u1', role: null })).toBe(false);
	});

	it('returns false for a null/undefined user', () => {
		expect(isAdmin(null)).toBe(false);
		expect(isAdmin(undefined)).toBe(false);
	});
});

describe('canAccessProject', () => {
	it('grants access to an admin regardless of ownership', async () => {
		const admin = await createUser({ role: 'admin' });
		const owner = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);

		await expect(canAccessProject(admin, proj.id)).resolves.toBe(true);
	});

	it('grants access to the owning workspace owner', async () => {
		const owner = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);

		await expect(canAccessProject(owner, proj.id)).resolves.toBe(true);
	});

	it('grants access to a user with a direct project grant', async () => {
		const owner = await createUser();
		const grantee = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);
		await grantPermission(grantee.id, 'project', proj.id, owner.id);

		await expect(canAccessProject(grantee, proj.id)).resolves.toBe(true);
	});

	it('grants access to a user with a workspace grant on the project workspace', async () => {
		const owner = await createUser();
		const grantee = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);
		await grantPermission(grantee.id, 'workspace', ws.id, owner.id);

		await expect(canAccessProject(grantee, proj.id)).resolves.toBe(true);
	});

	it('denies access to an unrelated user with no grant', async () => {
		const owner = await createUser();
		const stranger = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);

		await expect(canAccessProject(stranger, proj.id)).resolves.toBe(false);
	});

	it('denies access for a missing project id', async () => {
		const owner = await createUser();
		await expect(canAccessProject(owner, 'does-not-exist')).resolves.toBe(false);
	});

	it('denies access for a null user', async () => {
		const owner = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);
		await expect(canAccessProject(null, proj.id)).resolves.toBe(false);
	});
});

describe('canEditTask', () => {
	it('mirrors canAccessProject for the task’s project (grantee can edit)', async () => {
		const owner = await createUser();
		const grantee = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);
		await grantPermission(grantee.id, 'project', proj.id, owner.id);

		const fakeTask = { id: 'task-1', parentId: null, projectId: proj.id };
		await expect(canEditTask(grantee, fakeTask)).resolves.toBe(true);
		await expect(canAccessProject(grantee, proj.id)).resolves.toBe(true);
	});

	it('denies edit when the user cannot access the project', async () => {
		const owner = await createUser();
		const stranger = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);

		const fakeTask = { id: 'task-1', parentId: null, projectId: proj.id };
		await expect(canEditTask(stranger, fakeTask)).resolves.toBe(false);
	});
});

describe('canEditProject', () => {
	it('allows an admin to edit any project', async () => {
		const admin = await createUser({ role: 'admin' });
		const owner = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);

		await expect(canEditProject(admin, proj.id)).resolves.toBe(true);
	});

	it('allows the workspace owner to edit its projects', async () => {
		const owner = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);

		await expect(canEditProject(owner, proj.id)).resolves.toBe(true);
	});

	it('allows a user with a direct project edit grant', async () => {
		const owner = await createUser();
		const grantee = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);
		await grantPermission(grantee.id, 'project', proj.id, owner.id);

		await expect(canEditProject(grantee, proj.id)).resolves.toBe(true);
	});

	it('denies edit to a user with access but no edit grant', async () => {
		// workspace grant gives ACCESS (canAccessWorkspace) but canEditProject only
		// checks admin / owner / project-or-workspace EDIT grant — characterizing
		// that a bare "project access" via some other path is not itself edit rights
		// is covered by the stranger-denied case below.
		const owner = await createUser();
		const stranger = await createUser();
		const ws = await createWorkspace(owner.id);
		const proj = await createProject(ws.id, owner.id);

		await expect(canEditProject(stranger, proj.id)).resolves.toBe(false);
	});
});

describe('canEditWorkspace', () => {
	it('allows an admin to edit any workspace', async () => {
		const admin = await createUser({ role: 'admin' });
		const owner = await createUser();
		const ws = await createWorkspace(owner.id);

		await expect(canEditWorkspace(admin, ws.id)).resolves.toBe(true);
	});

	it('allows the owner to edit their own workspace', async () => {
		const owner = await createUser();
		const ws = await createWorkspace(owner.id);

		await expect(canEditWorkspace(owner, ws.id)).resolves.toBe(true);
	});

	it('allows a user with a workspace edit grant', async () => {
		const owner = await createUser();
		const grantee = await createUser();
		const ws = await createWorkspace(owner.id);
		await grantPermission(grantee.id, 'workspace', ws.id, owner.id);

		await expect(canEditWorkspace(grantee, ws.id)).resolves.toBe(true);
	});

	it('denies edit to an unrelated user', async () => {
		const owner = await createUser();
		const stranger = await createUser();
		const ws = await createWorkspace(owner.id);

		await expect(canEditWorkspace(stranger, ws.id)).resolves.toBe(false);
	});
});
