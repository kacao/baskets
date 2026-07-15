import { beforeEach, describe, expect, it } from 'vitest';
import { resetTables } from './isolationGuard';
import { createProject, seedProjectFixture } from './helpers/testDb';
import { createTemplate, getTemplate, updateTemplatePayload } from '$lib/server/templates';

beforeEach(resetTables);

const payload = (title: string) => ({ task: { title } });

describe('updateTemplatePayload scope check', () => {
	it('a null projectId skips the project-relative reach check (REST adapter path)', async () => {
		const { owner, proj } = await seedProjectFixture();
		const id = await createTemplate({
			name: 'T',
			scope: 'project',
			projectId: proj.id,
			workspaceId: null,
			payload: payload('v1'),
			createdBy: owner.id
		});

		const res = await updateTemplatePayload(id, null, payload('v2'), 'Renamed');
		expect(res).toEqual({ scope: 'project', workspaceId: null });

		const row = await getTemplate(id);
		expect(row?.name).toBe('Renamed');
		expect(JSON.parse(row!.payload).task.title).toBe('v2');
	});

	it('still rejects an out-of-scope projectId (form-action path unchanged)', async () => {
		const { owner, proj, ws } = await seedProjectFixture();
		const id = await createTemplate({
			name: 'T',
			scope: 'project',
			projectId: proj.id,
			workspaceId: null,
			payload: payload('v1'),
			createdBy: owner.id
		});

		const other = await createProject(ws.id, owner.id, 'Other project');
		const res = await updateTemplatePayload(id, other.id, payload('v2'));
		expect(res).toBeNull();

		const row = await getTemplate(id);
		expect(row?.name).toBe('T');
		expect(JSON.parse(row!.payload).task.title).toBe('v1');
	});

	it('a workspace-scoped template stays reachable from any project of its workspace', async () => {
		const { owner, proj, ws } = await seedProjectFixture();
		const id = await createTemplate({
			name: 'WT',
			scope: 'workspace',
			projectId: proj.id,
			workspaceId: ws.id,
			payload: payload('v1'),
			createdBy: owner.id
		});

		const sibling = await createProject(ws.id, owner.id, 'Sibling');
		const res = await updateTemplatePayload(id, sibling.id, payload('v2'));
		expect(res).toEqual({ scope: 'workspace', workspaceId: ws.id });
		expect(JSON.parse((await getTemplate(id))!.payload).task.title).toBe('v2');
	});
});
