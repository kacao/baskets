import type { AppEvent } from './index';

export const SLACK_WEBHOOK_HOST = 'https://hooks.slack.com/';

export type SlackConfig = {
	webhookUrl: string;
};

export function formatSlackMessage(event: AppEvent): string {
	switch (event.type) {
		case 'project.created':
			return `:open_file_folder: *${event.actor}* created project *${event.projectName}*`;
		case 'task.created':
			return `:memo: *${event.actor}* added task *${event.taskTitle}* in *${event.projectName}*`;
		case 'task.completed':
			return `:white_check_mark: *${event.actor}* completed task *${event.taskTitle}* in *${event.projectName}*`;
	}
}

export async function sendSlackMessage(config: SlackConfig, text: string) {
	const res = await fetch(config.webhookUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text }),
		signal: AbortSignal.timeout(5000)
	});
	if (!res.ok) {
		throw new Error(`Slack webhook responded ${res.status}`);
	}
}
