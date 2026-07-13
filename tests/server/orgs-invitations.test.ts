import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetTables } from './isolationGuard';
import { createMember, createOrg, createUser } from './helpers/testDb';
import { db } from '$lib/server/db';
import { invitation, member } from '$lib/server/db/schema.sqlite';
import {
	acceptInvitationService,
	cancelInvitationService,
	inviteMemberService
} from '$lib/server/orgs';

beforeEach(resetTables);

// ADR-062 D6/D8 — the invitation lifecycle. The accept LINK is the sole
// capability; gating follows ADR-019 (non-member actor → 404, member-below-admin
// → 403). A nonexistent org/invite and an out-of-org one share one error (no
// oracle). Everything asserts an explicit status, per R2.

async function insertInvite(opts: {
	orgId: string;
	email: string;
	inviterId: string;
	status?: string;
	expiresAt?: Date;
	role?: string;
}) {
	const id = `inv-${Math.random().toString(36).slice(2)}`;
	await db.insert(invitation).values({
		id,
		organizationId: opts.orgId,
		email: opts.email,
		role: opts.role ?? 'member',
		status: opts.status ?? 'pending',
		expiresAt: opts.expiresAt ?? new Date(Date.now() + 60_000),
		inviterId: opts.inviterId,
		createdAt: new Date()
	});
	return id;
}

describe('inviteMemberService (A4)', () => {
	it('is admin-gated: non-member actor → 404, plain member → 403, owner/admin → ok', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const plain = await createMember(org.id, 'member');
		const stranger = await createUser();

		const asStranger = await inviteMemberService(stranger.id, org.id, 'x@example.invalid');
		expect(asStranger.ok).toBe(false);
		if (!asStranger.ok) expect(asStranger.status).toBe(404); // org invisible to non-members

		const asPlain = await inviteMemberService(plain.id, org.id, 'x@example.invalid');
		expect(asPlain.ok).toBe(false);
		if (!asPlain.ok) expect(asPlain.status).toBe(403);

		const asOwner = await inviteMemberService(owner.id, org.id, 'newbie@example.invalid');
		expect(asOwner.ok).toBe(true);
	});

	it('rejects an invalid email (400) and a bad role (400)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');

		const badEmail = await inviteMemberService(owner.id, org.id, 'not-an-email');
		expect(badEmail.ok).toBe(false);
		if (!badEmail.ok) expect(badEmail.status).toBe(400);

		const badRole = await inviteMemberService(owner.id, org.id, 'ok@example.invalid', 'owner');
		expect(badRole.ok).toBe(false);
		if (!badRole.ok) expect(badRole.status).toBe(400); // owner is not invitable; use role change
	});

	it('rejects inviting someone who is already a member (400)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const existing = await createMember(org.id, 'member');

		const res = await inviteMemberService(owner.id, org.id, existing.email);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.status).toBe(400);
	});

	it('a re-invite cancels the prior pending invitation for the same email', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const first = await inviteMemberService(owner.id, org.id, 'again@example.invalid');
		expect(first.ok).toBe(true);
		if (!first.ok) return;

		const second = await inviteMemberService(owner.id, org.id, 'again@example.invalid');
		expect(second.ok).toBe(true);
		if (!second.ok) return;

		const [oldRow] = await db.select().from(invitation).where(eq(invitation.id, first.data.id));
		expect(oldRow.status).toBe('canceled');
		const pending = await db.select().from(invitation).where(eq(invitation.organizationId, org.id));
		expect(pending.filter((r) => r.status === 'pending')).toHaveLength(1);
	});
});

describe('acceptInvitationService (A4)', () => {
	it('happy path: creates the membership + marks the invitation accepted', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const invitee = await createUser();
		const id = await insertInvite({ orgId: org.id, email: invitee.email, inviterId: owner.id });

		const res = await acceptInvitationService({ id: invitee.id, email: invitee.email }, id);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.data.orgId).toBe(org.id);

		const [m] = await db.select().from(member).where(eq(member.userId, invitee.id));
		expect(m?.organizationId).toBe(org.id);
		const [inv] = await db.select().from(invitation).where(eq(invitation.id, id));
		expect(inv.status).toBe('accepted');
	});

	it('rejects a mismatched email (403 — email binding is a speed bump)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const invitee = await createUser();
		const id = await insertInvite({
			orgId: org.id,
			email: 'someone-else@example.invalid',
			inviterId: owner.id
		});

		const res = await acceptInvitationService({ id: invitee.id, email: invitee.email }, id);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.status).toBe(403);
	});

	it('rejects an expired invitation (400) and a canceled one (400) and a missing id (404)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const invitee = await createUser();

		const expired = await insertInvite({
			orgId: org.id,
			email: invitee.email,
			inviterId: owner.id,
			expiresAt: new Date(Date.now() - 60_000)
		});
		const expiredRes = await acceptInvitationService(
			{ id: invitee.id, email: invitee.email },
			expired
		);
		expect(expiredRes.ok).toBe(false);
		if (!expiredRes.ok) expect(expiredRes.status).toBe(400);

		const canceled = await insertInvite({
			orgId: org.id,
			email: invitee.email,
			inviterId: owner.id,
			status: 'canceled'
		});
		const canceledRes = await acceptInvitationService(
			{ id: invitee.id, email: invitee.email },
			canceled
		);
		expect(canceledRes.ok).toBe(false);
		if (!canceledRes.ok) expect(canceledRes.status).toBe(400);

		const missing = await acceptInvitationService(
			{ id: invitee.id, email: invitee.email },
			'no-such-invite'
		);
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.status).toBe(404);
	});

	it('case-insensitively matches the invited email', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const invitee = await createUser();
		const id = await insertInvite({
			orgId: org.id,
			email: invitee.email.toUpperCase(),
			inviterId: owner.id
		});
		const res = await acceptInvitationService({ id: invitee.id, email: invitee.email }, id);
		expect(res.ok).toBe(true);
	});
});

describe('cancelInvitationService (A4)', () => {
	it('org admin cancels a pending invite; a non-member cannot even see it (404)', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const stranger = await createUser();
		const id = await insertInvite({
			orgId: org.id,
			email: 'p@example.invalid',
			inviterId: owner.id
		});

		const asStranger = await cancelInvitationService(stranger.id, id);
		expect(asStranger.ok).toBe(false);
		if (!asStranger.ok) expect(asStranger.status).toBe(404); // hides the invite's existence

		const asOwner = await cancelInvitationService(owner.id, id);
		expect(asOwner.ok).toBe(true);
		const [row] = await db.select().from(invitation).where(eq(invitation.id, id));
		expect(row.status).toBe('canceled');
	});

	it('a plain member is forbidden (403), and a non-pending invite is a 400', async () => {
		const org = await createOrg();
		const owner = await createMember(org.id, 'owner');
		const plain = await createMember(org.id, 'member');
		const id = await insertInvite({
			orgId: org.id,
			email: 'p@example.invalid',
			inviterId: owner.id
		});

		const asPlain = await cancelInvitationService(plain.id, id);
		expect(asPlain.ok).toBe(false);
		if (!asPlain.ok) expect(asPlain.status).toBe(403);

		const already = await insertInvite({
			orgId: org.id,
			email: 'q@example.invalid',
			inviterId: owner.id,
			status: 'accepted'
		});
		const res = await cancelInvitationService(owner.id, already);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.status).toBe(400);
	});
});
