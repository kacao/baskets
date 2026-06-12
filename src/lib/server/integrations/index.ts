import { eq } from 'drizzle-orm';
import { db } from '../db';
import { integration } from '../db/schema';
import { formatSlackMessage, sendSlackMessage, type SlackConfig } from './slack';

export type AppEvent =
	| { type: 'project.created'; actor: string; projectName: string }
	| { type: 'task.created'; actor: string; projectName: string; taskTitle: string }
	| { type: 'task.completed'; actor: string; projectName: string; taskTitle: string };

/**
 * Fire-and-forget: call without await from actions/endpoints.
 * Never throws — integration failures must not break app mutations.
 */
export async function dispatchEvent(event: AppEvent) {
	try {
		const [slack] = await db.select().from(integration).where(eq(integration.type, 'slack'));
		if (!slack?.enabled) return;

		const config = JSON.parse(slack.config) as SlackConfig;
		await sendSlackMessage(config, formatSlackMessage(event));
	} catch (err) {
		console.error('[integrations] dispatch failed:', err);
	}
}
