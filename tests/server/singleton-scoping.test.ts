import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTables } from './isolationGuard';
import {
	createIntegration,
	createMember,
	createOrg,
	createProject,
	createWorkspace,
	insertNotification
} from './helpers/testDb';
import * as notifications from '$lib/server/notifications';

// The two highest-severity single-tenant singletons (R1 Slack, R2 merged
// notifications). A8 proves they are now org-partitioned: one org's rows never
// surface for, or dispatch to, another org.

// Mock the Slack transport so dispatchEvent never touches the network; we assert
// WHICH org's config it selected, which is the whole isolation guarantee (R1).
vi.mock('$lib/server/integrations/slack', () => ({
	formatSlackMessage: vi.fn(() => 'formatted message'),
	sendSlackMessage: vi.fn(async () => {})
}));

import { dispatchEvent } from '$lib/server/integrations';
import { sendSlackMessage } from '$lib/server/integrations/slack';

beforeEach(async () => {
	await resetTables();
	vi.mocked(sendSlackMessage).mockClear();
});

describe('notification org scoping (A8)', () => {
	it('create() stamps the org from the projectId; a null/unresolvable project is skipped', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const ws = await createWorkspace(owner.id, 'W', org.id);
		const proj = await createProject(ws.id, owner.id);

		const row = await notifications.create({
			userId: owner.id,
			type: 'mention',
			body: 'hi',
			projectId: proj.id
		});
		expect(row).not.toBeNull();
		expect(row?.organizationId).toBe(org.id);

		// no projectId → org can't be derived → skipped (never stored org-less)
		const orphan = await notifications.create({ userId: owner.id, type: 'mention', body: 'no' });
		expect(orphan).toBeNull();
	});

	it('listForUser / unreadCount return ONLY notifications from orgs the user still belongs to', async () => {
		const orgA = await createOrg('A');
		const orgB = await createOrg('B');
		// the user is a member of orgB ONLY
		const u = await createMember(orgB.id, 'member');

		// a notification addressed to `u` but tied to orgA (e.g. left over from a past
		// membership) must NOT appear in u's orgB-scoped bell.
		await insertNotification({ userId: u.id, organizationId: orgA.id, read: false });
		// a legitimate orgB notification for `u`
		await insertNotification({ userId: u.id, organizationId: orgB.id, read: false });

		const list = await notifications.listForUser(u.id);
		expect(list).toHaveLength(1);
		expect(list[0].organizationId).toBe(orgB.id);
		expect(await notifications.unreadCount(u.id)).toBe(1);
	});

	it('a user who belongs to NO org sees an empty bell even if rows target them', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		// owner IS a member; but query a stranger with a row addressed to them in `org`
		const { createUser } = await import('./helpers/testDb');
		const stranger = await createUser();
		await insertNotification({ userId: stranger.id, organizationId: org.id });
		expect(await notifications.listForUser(stranger.id)).toHaveLength(0);
		expect(await notifications.unreadCount(stranger.id)).toBe(0);
		expect(owner).toBeTruthy();
	});
});

describe('Slack dispatch org scoping (A8 / R1)', () => {
	async function twoOrgsWithSlack() {
		const orgA = await createOrg('A');
		const ownerA = await createMember(orgA.id, 'owner');
		const wsA = await createWorkspace(ownerA.id, 'WA', orgA.id);
		const projA = await createProject(wsA.id, ownerA.id, 'PA');
		await createIntegration(orgA.id, ownerA.id, {
			webhookUrl: 'https://hooks.slack.com/A',
			marker: 'A'
		});

		const orgB = await createOrg('B');
		const ownerB = await createMember(orgB.id, 'owner');
		const wsB = await createWorkspace(ownerB.id, 'WB', orgB.id);
		const projB = await createProject(wsB.id, ownerB.id, 'PB');
		await createIntegration(orgB.id, ownerB.id, {
			webhookUrl: 'https://hooks.slack.com/B',
			marker: 'B'
		});

		return { orgA, projA, orgB, projB };
	}

	it('an event for orgA’s project dispatches to orgA’s webhook ONLY (never orgB’s)', async () => {
		const { projA } = await twoOrgsWithSlack();
		await dispatchEvent({
			type: 'task.created',
			actor: 'someone',
			projectName: 'PA',
			taskTitle: 'T',
			projectId: projA.id
		});
		expect(sendSlackMessage).toHaveBeenCalledTimes(1);
		const [config] = vi.mocked(sendSlackMessage).mock.calls[0];
		expect((config as unknown as { marker: string }).marker).toBe('A');
	});

	it('an event for orgB’s project selects orgB’s config', async () => {
		const { projB } = await twoOrgsWithSlack();
		await dispatchEvent({
			type: 'project.created',
			actor: 'someone',
			projectName: 'PB',
			projectId: projB.id
		});
		expect(sendSlackMessage).toHaveBeenCalledTimes(1);
		const [config] = vi.mocked(sendSlackMessage).mock.calls[0];
		expect((config as unknown as { marker: string }).marker).toBe('B');
	});

	it('does NOT dispatch for a project whose org has no integration row, even when another org does', async () => {
		const { orgB, projB } = await twoOrgsWithSlack();
		// give orgA a project but NO slack row; orgB keeps its slack row.
		const orgA2 = await createOrg('A2');
		const ownerA2 = await createMember(orgA2.id, 'owner');
		const wsA2 = await createWorkspace(ownerA2.id, 'WA2', orgA2.id);
		const projA2 = await createProject(wsA2.id, ownerA2.id, 'PA2');

		await dispatchEvent({
			type: 'project.created',
			actor: 'x',
			projectName: 'PA2',
			projectId: projA2.id
		});
		// orgA2 has no slack row → no dispatch (and definitely not to orgB's webhook)
		expect(sendSlackMessage).not.toHaveBeenCalled();
		expect(orgB.id).not.toBe(projB.id);
	});
});
