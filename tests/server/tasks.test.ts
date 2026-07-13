import { beforeEach, describe, expect, it } from 'vitest';
import { resetTables } from './isolationGuard';
import { seedProjectFixture } from './helpers/testDb';
import {
	bulkUpdateTasks,
	createTaskService,
	setTaskStatusService
} from '$lib/server/tasks';

beforeEach(resetTables);

// `has` mirrors the form-action/REST adapters' "was this key actually supplied"
// semantics required by BulkSet/UpdateTaskOptions.
function has<T extends object>(obj: T) {
	const keys = new Set(Object.keys(obj));
	return (key: string) => keys.has(key);
}

describe('task status cascade (characterization)', () => {
	it('completing a parent task also completes its sub-tasks', async () => {
		const { owner, proj, statuses } = await seedProjectFixture();

		const parentRes = await createTaskService(
			{ projectId: proj.id, title: 'Parent task' },
			owner
		);
		expect(parentRes.ok).toBe(true);
		if (!parentRes.ok) return;
		const parent = parentRes.data;

		const subRes = await createTaskService(
			{ projectId: proj.id, title: 'Sub task', parentId: parent.id },
			owner
		);
		expect(subRes.ok).toBe(true);
		if (!subRes.ok) return;
		const sub = subRes.data;
		expect(sub.parentId).toBe(parent.id);

		const setRes = await setTaskStatusService(parent.id, proj.id, statuses.completed.id, owner);
		expect(setRes.ok).toBe(true);

		const { db } = await import('$lib/server/db');
		const { task } = await import('$lib/server/db/schema.sqlite');
		const { eq } = await import('drizzle-orm');
		const [updatedParent] = await db.select().from(task).where(eq(task.id, parent.id));
		const [updatedSub] = await db.select().from(task).where(eq(task.id, sub.id));

		expect(updatedParent.statusId).toBe(statuses.completed.id);
		expect(updatedSub.statusId).toBe(statuses.completed.id);
	});
});

describe('one level of nesting only (characterization)', () => {
	it('rejects creating a task whose parent is itself a sub-task', async () => {
		const { owner, proj } = await seedProjectFixture();

		const parentRes = await createTaskService({ projectId: proj.id, title: 'Top' }, owner);
		expect(parentRes.ok).toBe(true);
		if (!parentRes.ok) return;

		const subRes = await createTaskService(
			{ projectId: proj.id, title: 'Sub', parentId: parentRes.data.id },
			owner
		);
		expect(subRes.ok).toBe(true);
		if (!subRes.ok) return;
		const sub = subRes.data;

		// Attempt to create a grandchild under `sub` (a sub-task) — must be rejected.
		const grandchildRes = await createTaskService(
			{ projectId: proj.id, title: 'Grandchild', parentId: sub.id },
			owner
		);

		expect(grandchildRes.ok).toBe(false);
		if (grandchildRes.ok) return;
		expect(grandchildRes.status).toBe(400);
		expect(grandchildRes.message).toMatch(/sub-tasks cannot have their own sub-tasks/i);
	});
});

describe('bulk edit (characterization)', () => {
	it('applies a priority change across every selected task', async () => {
		const { owner, proj } = await seedProjectFixture();

		const t1 = await createTaskService({ projectId: proj.id, title: 'One' }, owner);
		const t2 = await createTaskService({ projectId: proj.id, title: 'Two' }, owner);
		expect(t1.ok && t2.ok).toBe(true);
		if (!t1.ok || !t2.ok) return;

		const result = await bulkUpdateTasks(
			[t1.data.id, t2.data.id],
			proj.id,
			{ priority: 'urgent', has: has({ priority: 'urgent' }) },
			owner
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.updated).toBe(2);

		const { db } = await import('$lib/server/db');
		const { task } = await import('$lib/server/db/schema.sqlite');
		const { inArray } = await import('drizzle-orm');
		const rows = await db
			.select()
			.from(task)
			.where(inArray(task.id, [t1.data.id, t2.data.id]));
		expect(rows.every((r) => r.priority === 'urgent')).toBe(true);
	});
});

describe('sub-task milestone inheritance (characterization)', () => {
	it('a new sub-task inherits the parent’s milestoneId regardless of its own milestoneId input', async () => {
		const { owner, proj } = await seedProjectFixture();

		const { db } = await import('$lib/server/db');
		const { milestone } = await import('$lib/server/db/schema.sqlite');
		const now = new Date();
		const milestoneId = `ms-${Date.now()}`;
		await db.insert(milestone).values({
			id: milestoneId,
			projectId: proj.id,
			name: 'M1',
			createdAt: now,
			updatedAt: now
		});

		const parentRes = await createTaskService(
			{ projectId: proj.id, title: 'Parent', milestoneId },
			owner
		);
		expect(parentRes.ok).toBe(true);
		if (!parentRes.ok) return;
		expect(parentRes.data.milestoneId).toBe(milestoneId);

		// Sub-task creation passes NO milestoneId — service should still inherit
		// the parent's, per createTaskService's `if (parent) milestoneId = parent.milestoneId`.
		const subRes = await createTaskService(
			{ projectId: proj.id, title: 'Sub', parentId: parentRes.data.id },
			owner
		);
		expect(subRes.ok).toBe(true);
		if (!subRes.ok) return;
		expect(subRes.data.milestoneId).toBe(milestoneId);
	});
});
