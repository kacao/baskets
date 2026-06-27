// Server-side mention handling: turn `person:` references inside saved text into
// notifications. Fire-and-forget — `notifyMentions(...)` never throws and only
// notifies people who were NEWLY mentioned (diffing against the prior text), never
// the actor themselves.

import { create } from '$lib/server/notifications';
import { extractRefs } from '$lib/mentions';

/** Unique user ids referenced via `@[…](person:id)` in the text. */
export function mentionedUserIds(text: string | null | undefined): string[] {
	return [...new Set(extractRefs(text).filter((r) => r.kind === 'person').map((r) => r.id))];
}

export function notifyMentions(opts: {
	text: string | null | undefined;
	prevText?: string | null;
	actorId: string;
	actorName?: string | null;
	projectId: string;
	taskId?: string | null;
	/** human context for the notification body, e.g. `"Fix login"` or `a comment on "Fix login"` */
	contextLabel?: string;
}): void {
	const now = mentionedUserIds(opts.text);
	if (now.length === 0) return;
	const before = new Set(mentionedUserIds(opts.prevText));
	const fresh = now.filter((id) => !before.has(id) && id !== opts.actorId);
	if (fresh.length === 0) return;

	const who = opts.actorName?.trim() || 'Someone';
	const where = opts.contextLabel ? ` in ${opts.contextLabel}` : '';
	const body = `${who} mentioned you${where}`;
	for (const userId of fresh) {
		void create({
			userId,
			type: 'mention',
			body,
			projectId: opts.projectId,
			taskId: opts.taskId ?? null
		});
	}
}
