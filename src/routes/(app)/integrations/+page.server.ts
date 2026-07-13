import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { integration } from '$lib/server/db/schema';
import {
	SLACK_WEBHOOK_HOST,
	sendSlackMessage,
	type SlackConfig
} from '$lib/server/integrations/slack';
import { isOrgAdmin, resolveActiveOrg } from '$lib/server/orgs';
import type { Actions, PageServerLoad } from './$types';

/** The active org's Slack row (ADR-062 — one integration row per (org, type)). */
async function getSlack(orgId: string) {
	const [row] = await db
		.select()
		.from(integration)
		.where(and(eq(integration.organizationId, orgId), eq(integration.type, 'slack')));
	return row ?? null;
}

/** Resolve the active org and require the caller to be an org owner/admin of it. */
async function requireOrgAdmin(
	locals: App.Locals,
	cookies: import('@sveltejs/kit').Cookies
): Promise<{ ok: true; orgId: string } | { ok: false; status: number; message: string }> {
	if (!locals.user) return { ok: false, status: 401, message: 'Not signed in' };
	const org = await resolveActiveOrg(locals.user, cookies);
	if (!org || !(await isOrgAdmin(locals.user.id, org.id)))
		return { ok: false, status: 403, message: 'Admins only' };
	return { ok: true, orgId: org.id };
}

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const org = await resolveActiveOrg(locals.user, cookies);
	const admin = org && locals.user ? await isOrgAdmin(locals.user.id, org.id) : false;
	const slack = org ? await getSlack(org.id) : null;

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
	saveSlack: async ({ request, locals, cookies }) => {
		const gate = await requireOrgAdmin(locals, cookies);
		if (!gate.ok) return fail(gate.status, { message: gate.message });

		const form = await request.formData();
		const webhookUrl = String(form.get('webhookUrl') ?? '').trim();

		if (!webhookUrl.startsWith(SLACK_WEBHOOK_HOST))
			return fail(400, { message: `Webhook URL must start with ${SLACK_WEBHOOK_HOST}` });

		const config = JSON.stringify({ webhookUrl } satisfies SlackConfig);
		const now = new Date();
		const existing = await getSlack(gate.orgId);

		if (existing) {
			await db
				.update(integration)
				.set({ config, enabled: true, updatedAt: now })
				.where(eq(integration.id, existing.id));
		} else {
			await db.insert(integration).values({
				id: crypto.randomUUID(),
				type: 'slack',
				organizationId: gate.orgId,
				enabled: true,
				config,
				createdBy: locals.user!.id,
				createdAt: now,
				updatedAt: now
			});
		}

		return { saved: true };
	},

	toggleSlack: async ({ locals, cookies }) => {
		const gate = await requireOrgAdmin(locals, cookies);
		if (!gate.ok) return fail(gate.status, { message: gate.message });

		const existing = await getSlack(gate.orgId);
		if (!existing) return fail(404, { message: 'Slack is not connected' });

		await db
			.update(integration)
			.set({ enabled: !existing.enabled, updatedAt: new Date() })
			.where(eq(integration.id, existing.id));

		return { toggled: true };
	},

	removeSlack: async ({ locals, cookies }) => {
		const gate = await requireOrgAdmin(locals, cookies);
		if (!gate.ok) return fail(gate.status, { message: gate.message });

		await db
			.delete(integration)
			.where(and(eq(integration.organizationId, gate.orgId), eq(integration.type, 'slack')));
		return { removed: true };
	},

	testSlack: async ({ locals, cookies }) => {
		const gate = await requireOrgAdmin(locals, cookies);
		if (!gate.ok) return fail(gate.status, { message: gate.message });

		const existing = await getSlack(gate.orgId);
		if (!existing) return fail(404, { message: 'Slack is not connected' });

		try {
			const config = JSON.parse(existing.config) as SlackConfig;
			await sendSlackMessage(
				config,
				`:basket: Test message from Baskets — sent by *${locals.user!.name}*`
			);
		} catch {
			return fail(502, { message: 'Test failed — Slack did not accept the message' });
		}

		return { tested: true };
	}
};
