// Server-side mention handling: turn `person:` references inside saved text into
// notifications. Fire-and-forget — `notifyMentions(...)` never throws/rejects (an
// unhandled promise rejection is fatal in Node) and only notifies people who were
// NEWLY mentioned (diffing against the prior text), are NOT the actor, and CAN
// access the project (so a hand-crafted person:<any-id> token can't notify or leak
// context to arbitrary users).

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import { create } from '$lib/server/notifications';
import { projectAccessUserIds } from '$lib/server/permissions';
import { extractRefs } from '$lib/mentions';

/** Unique user ids referenced via `@[…](person:id)` in the text. */
export function mentionedUserIds(text: string | null | undefined): string[] {
	return [
		...new Set(
			extractRefs(text)
				.filter((r) => r.kind === 'person')
				.map((r) => r.id)
		)
	];
}

export async function notifyMentions(opts: {
	text: string | null | undefined;
	prevText?: string | null;
	actorId: string;
	actorName?: string | null;
	projectId: string;
	taskId?: string | null;
	/** human context for the notification body, e.g. `"Fix login"` or `a comment on "Fix login"` */
	contextLabel?: string;
}): Promise<void> {
	try {
		const now = mentionedUserIds(opts.text);
		if (now.length === 0) return;
		const before = new Set(mentionedUserIds(opts.prevText));
		const fresh = now.filter((id) => !before.has(id) && id !== opts.actorId);
		if (fresh.length === 0) return;

		// only notify users who can actually access this project — a person:<id> token
		// is attacker-controlled text, so never trust it to address an arbitrary user
		const [proj] = await db
			.select({ workspaceId: project.workspaceId })
			.from(project)
			.where(eq(project.id, opts.projectId));
		const allowed = await projectAccessUserIds(opts.projectId, proj?.workspaceId ?? null);
		const targets = fresh.filter((id) => allowed.has(id));
		if (targets.length === 0) return;

		const who = opts.actorName?.trim() || 'Someone';
		const where = opts.contextLabel ? ` in ${opts.contextLabel}` : '';
		const body = `${who} mentioned you${where}`;
		for (const userId of targets) {
			void create({
				userId,
				type: 'mention',
				body,
				projectId: opts.projectId,
				taskId: opts.taskId ?? null
			});
		}
	} catch (err) {
		// fire-and-forget: swallow so a DB hiccup can't crash the process
		console.error('notifyMentions failed', err);
	}
}
