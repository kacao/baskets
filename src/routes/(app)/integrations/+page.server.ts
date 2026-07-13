import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { integration } from '$lib/server/db/schema';
import {
	SLACK_WEBHOOK_HOST,
	sendSlackMessage,
	type SlackConfig
} from '$lib/server/integrations/slack';
import { isAdmin } from '$lib/server/permissions';
import type { Actions, PageServerLoad } from './$types';

async function getSlack() {
	const [row] = await db.select().from(integration).where(eq(integration.type, 'slack'));
	return row ?? null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const slack = await getSlack();
	const admin = isAdmin(locals.user);

	return {
		slack: slack
			? {
					enabled: slack.enabled,
					// never ship the full webhook URL; even the hint is admins-only
					webhookHint: admin
						? '…' + (JSON.parse(slack.config) as SlackConfig).webhookUrl.slice(-8)
						: null,
					updatedAt: slack.updatedAt
				}
			: null
	};
};

export const actions: Actions = {
	saveSlack: async ({ request, locals }) => {
		if (!locals.user || !isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

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
		if (!locals.user || !isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		const existing = await getSlack();
		if (!existing) return fail(404, { message: 'Slack is not connected' });

		await db
			.update(integration)
			.set({ enabled: !existing.enabled, updatedAt: new Date() })
			.where(eq(integration.id, existing.id));

		return { toggled: true };
	},

	removeSlack: async ({ locals }) => {
		if (!locals.user || !isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		await db.delete(integration).where(eq(integration.type, 'slack'));
		return { removed: true };
	},

	testSlack: async ({ locals }) => {
		if (!locals.user || !isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

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
