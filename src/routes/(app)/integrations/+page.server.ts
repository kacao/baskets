import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { integration } from '$lib/server/db/schema';
import { SLACK_WEBHOOK_HOST, sendSlackMessage, type SlackConfig } from '$lib/server/integrations/slack';
import type { Actions, PageServerLoad } from './$types';

async function getSlack() {
	const [row] = await db.select().from(integration).where(eq(integration.type, 'slack'));
	return row ?? null;
}

export const load: PageServerLoad = async () => {
	const slack = await getSlack();

	return {
		slack: slack
			? {
					enabled: slack.enabled,
					// never ship the full webhook URL to the client
					webhookHint: '…' + (JSON.parse(slack.config) as SlackConfig).webhookUrl.slice(-8),
					updatedAt: slack.updatedAt
				}
			: null
	};
};

export const actions: Actions = {
	saveSlack: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const webhookUrl = String(form.get('webhookUrl') ?? '').trim();

		if (!webhookUrl.startsWith(SLACK_WEBHOOK_HOST))
			return fail(400, { message: `Webhook URL must start with ${SLACK_WEBHOOK_HOST}` });

		const config = JSON.stringify({ webhookUrl } satisfies SlackConfig);
		const now = new Date();
		const existing = await getSlack();

		if (existing) {
			await db
				.update(integration)
				.set({ config, enabled: true, updatedAt: now })
				.where(eq(integration.id, existing.id));
		} else {
			await db.insert(integration).values({
				id: crypto.randomUUID(),
				type: 'slack',
				enabled: true,
				config,
				createdBy: locals.user.id,
				createdAt: now,
				updatedAt: now
			});
		}

		return { saved: true };
	},

	toggleSlack: async ({ locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const existing = await getSlack();
		if (!existing) return fail(404, { message: 'Slack is not connected' });

		await db
			.update(integration)
			.set({ enabled: !existing.enabled, updatedAt: new Date() })
			.where(eq(integration.id, existing.id));

		return { toggled: true };
	},

	removeSlack: async ({ locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		await db.delete(integration).where(eq(integration.type, 'slack'));
		return { removed: true };
	},

	testSlack: async ({ locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const existing = await getSlack();
		if (!existing) return fail(404, { message: 'Slack is not connected' });

		try {
			const config = JSON.parse(existing.config) as SlackConfig;
			await sendSlackMessage(
				config,
				`:basket: Test message from Baskets — sent by *${locals.user.name}*`
			);
		} catch {
			return fail(502, { message: 'Test failed — Slack did not accept the message' });
		}

		return { tested: true };
	}
};
