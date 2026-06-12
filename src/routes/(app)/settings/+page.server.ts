import { fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { apiKey } from '$lib/server/db/schema';
import { generateApiKey } from '$lib/server/api-keys';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const keys = await db
		.select({
			id: apiKey.id,
			name: apiKey.name,
			prefix: apiKey.prefix,
			lastUsedAt: apiKey.lastUsedAt,
			createdAt: apiKey.createdAt
		})
		.from(apiKey)
		.where(eq(apiKey.userId, locals.user!.id))
		.orderBy(desc(apiKey.createdAt));

	return { apiKeys: keys };
};

export const actions: Actions = {
	createKey: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();

		if (!name) return fail(400, { message: 'Key name is required' });
		if (name.length > 60) return fail(400, { message: 'Key name too long (max 60)' });

		const { token, prefix, keyHash } = generateApiKey();

		await db.insert(apiKey).values({
			id: crypto.randomUUID(),
			name,
			prefix,
			keyHash,
			userId: locals.user.id,
			createdAt: new Date()
		});

		// Plaintext token returned exactly once — only the hash is stored
		return { token, keyName: name };
	},

	revokeKey: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Missing key id' });

		await db.delete(apiKey).where(and(eq(apiKey.id, id), eq(apiKey.userId, locals.user.id)));

		return { revoked: true };
	}
};
