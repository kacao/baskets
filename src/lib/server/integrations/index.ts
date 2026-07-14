import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { integration, project, workspace } from '../db/schema';
import { formatSlackMessage, sendSlackMessage, type SlackConfig } from './slack';

export type AppEvent =
	| { type: 'project.created'; actor: string; projectName: string; projectId: string }
	| {
			type: 'task.created';
			actor: string;
			projectName: string;
			taskTitle: string;
			projectId: string;
	  }
	| {
			type: 'task.completed';
			actor: string;
			projectName: string;
			taskTitle: string;
			projectId: string;
	  };

/**
 * Fire-and-forget: call without await from actions/endpoints.
 * Never throws — integration failures must not break app mutations.
 *
 * The event's org is resolved from its project → workspace → organization, and
 * only THAT org's integration row is dispatched to (ADR-062): a second org's
 * project/task/actor names never post to the first org's webhook.
 */
export async function dispatchEvent(event: AppEvent) {
	try {
		const [row] = await db
			.select({ orgId: workspace.organizationId })
			.from(project)
			.leftJoin(workspace, eq(project.workspaceId, workspace.id))
			.where(eq(project.id, event.projectId));
		const orgId = row?.orgId ?? null;
		if (!orgId) return;

		const [slack] = await db
			.select()
			.from(integration)
			.where(and(eq(integration.organizationId, orgId), eq(integration.type, 'slack')));
		if (!slack?.enabled) return;

		const config = JSON.parse(slack.config) as SlackConfig;
		await sendSlackMessage(config, formatSlackMessage(event));
	} catch (err) {
		console.error('[integrations] dispatch failed:', err);
	}
}
