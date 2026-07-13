import { error, fail, redirect } from '@sveltejs/kit';
import { acceptInvitationService, getInvitationForAccept } from '$lib/server/orgs';
import type { Actions, PageServerLoad } from './$types';

/** Mask an email for the wrong-account screen: `t***@example.com`. */
function maskEmail(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) return '***';
	const first = email[0];
	const domain = email.slice(at);
	return `${first}***${domain}`;
}

type InviteState = 'signed-out' | 'wrong-email' | 'ready' | 'expired' | 'canceled' | 'accepted';

export const load: PageServerLoad = async ({ params, locals }) => {
	const inv = await getInvitationForAccept(params.id);
	if (!inv) error(404, 'Invitation not found');

	const expired = inv.expiresAt.getTime() < Date.now();
	let state: InviteState;
	if (inv.status === 'accepted') state = 'accepted';
	else if (inv.status !== 'pending') state = 'canceled';
	else if (expired) state = 'expired';
	else if (!locals.user) state = 'signed-out';
	// pre-check the email match BEFORE any accept call so we never surface a raw
	// 403 from the service (ADR-062 D6).
	else if (locals.user.email.toLowerCase() !== inv.email.toLowerCase()) state = 'wrong-email';
	else state = 'ready';

	return {
		orgName: inv.orgName,
		invitationId: inv.id,
		state,
		// only reveal (masked) the invited address on the wrong-account screen so the
		// signed-in user knows which account to switch to.
		invitedEmailMasked: state === 'wrong-email' ? maskEmail(inv.email) : null,
		redirectParam: `/invite/${inv.id}`
	};
};

export const actions: Actions = {
	accept: async ({ params, locals, cookies }) => {
		if (!locals.user) return fail(401, { message: 'Sign in to accept this invitation' });
		const res = await acceptInvitationService(
			{ id: locals.user.id, email: locals.user.email },
			params.id
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		// switch the active org to the just-joined one (the plugin only writes
		// session.activeOrganizationId, which the app ignores — D4)
		cookies.set('org', res.data.orgId, { path: '/', maxAge: 31536000, sameSite: 'lax' });
		cookies.delete('workspace', { path: '/' });
		redirect(303, '/projects');
	}
};
