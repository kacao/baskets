import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { member, organization } from '$lib/server/db/schema';
import { apiError } from '$lib/server/api';
import type { RequestHandler } from './$types';

/**
 * Current session identity. Used by the realtime transport (ADR-026) to
 * authenticate a /ws upgrade by forwarding the session cookie, and usable by
 * REST clients to confirm who a key belongs to.
 *
 * The transport (attach.js) reads ONLY `user` — `orgs` is purely additive (ADR-062)
 * so its minimal parse is unaffected.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// The caller's org memberships (id/name/slug + their role), oldest org first.
	const orgs = await db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			role: member.role
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(eq(member.userId, locals.user.id))
		.orderBy(asc(organization.createdAt));

	return json({ user: { id: locals.user.id, name: locals.user.name }, orgs });
};
