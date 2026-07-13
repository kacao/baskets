import { and, desc, eq, isNotNull, lte, gte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notification, task, status } from '$lib/server/db/schema';

export type NotificationRow = typeof notification.$inferSelect;

export type CreateNotificationInput = {
	userId: string;
	type: string; // assigned | mention | due_soon | overdue | ...
	body: string;
	projectId?: string | null;
	taskId?: string | null;
};

/**
 * Insert a single notification. Returns the created row, or null on failure.
 * Safe to fire-and-forget (`void create(...)`): never rejects.
 */
export async function create(input: CreateNotificationInput): Promise<NotificationRow | null> {
	try {
		const [row] = await db
			.insert(notification)
			.values({
				id: crypto.randomUUID(),
				userId: input.userId,
				type: input.type,
				body: input.body,
				projectId: input.projectId ?? null,
				taskId: input.taskId ?? null,
				read: false,
				createdAt: new Date()
			})
			.returning();
		return row;
	} catch (err) {
		console.error('notifications.create failed', err);
		return null;
	}
}

/** Most-recent-first notifications for a user. */
export async function listForUser(userId: string, limit = 50): Promise<NotificationRow[]> {
	return db
		.select()
		.from(notification)
		.where(eq(notification.userId, userId))
		.orderBy(desc(notification.createdAt))
		.limit(limit);
}

/** Count of unread notifications for a user. */
export async function unreadCount(userId: string): Promise<number> {
	const rows = await db
		.select({ id: notification.id })
		.from(notification)
		.where(and(eq(notification.userId, userId), eq(notification.read, false)));
	return rows.length;
}

/** Mark a single notification read. Scoped to the owner; returns true if updated. */
export async function markRead(id: string, userId: string): Promise<boolean> {
	const res = await db
		.update(notification)
		.set({ read: true })
		.where(and(eq(notification.id, id), eq(notification.userId, userId)))
		.returning({ id: notification.id });
	return res.length > 0;
}

/** Mark every unread notification for a user read. Returns count updated. */
export async function markAllRead(userId: string): Promise<number> {
	const res = await db
		.update(notification)
		.set({ read: true })
		.where(and(eq(notification.userId, userId), eq(notification.read, false)))
		.returning({ id: notification.id });
	return res.length;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

/**
 * Scan the user's assigned, not-completed tasks with a dueDate and insert
 * due_soon (within 24h, future) / overdue (past) notifications. Idempotent per
 * day: a (task, type) reminder is only created once within any given calendar
 * day, so calling this repeatedly (e.g. on bell mount) won't spam.
 */
export async function generateDueReminders(userId: string): Promise<NotificationRow[]> {
	const now = new Date();
	const soon = new Date(now.getTime() + DAY_MS);

	const rows = await db
		.select({
			id: task.id,
			title: task.title,
			projectId: task.projectId,
			dueDate: task.dueDate,
			category: status.category
		})
		.from(task)
		.innerJoin(status, eq(task.statusId, status.id))
		.where(and(eq(task.assigneeId, userId), isNotNull(task.dueDate), lte(task.dueDate, soon)));

	const dayStart = startOfDay(now);
	const created: NotificationRow[] = [];

	for (const r of rows) {
		if (!r.dueDate) continue;
		if (r.category === 'completed' || r.category === 'canceled') continue;
		const overdue = r.dueDate.getTime() < now.getTime();
		const type = overdue ? 'overdue' : 'due_soon';

		// idempotency: skip if a same-type reminder for this task exists today
		const existing = await db
			.select({ id: notification.id })
			.from(notification)
			.where(
				and(
					eq(notification.userId, userId),
					eq(notification.taskId, r.id),
					eq(notification.type, type),
					gte(notification.createdAt, dayStart)
				)
			);
		if (existing.length > 0) continue;

		const body = overdue ? `Overdue: "${r.title}"` : `Due soon: "${r.title}"`;
		const row = await create({ userId, type, body, projectId: r.projectId, taskId: r.id });
		if (row) created.push(row);
	}

	return created;
}
