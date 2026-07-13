import { error, fail, redirect } from '@sveltejs/kit';
import {
	cancelInvitationService,
	deleteOrganizationGuarded,
	inviteMemberService,
	leaveOrgService,
	listMembers,
	listPendingInvitations,
	listUserOrgs,
	orgRole,
	removeMemberService,
	updateMemberRoleService,
	updateOrganizationService
} from '$lib/server/orgs';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(302, '/login');

	// ADR-019: a non-member must not tell a real org from a missing one → 404.
	// listUserOrgs is membership-scoped, so a miss = non-member OR nonexistent.
	const orgs = await listUserOrgs(locals.user.id);
	const org = orgs.find((o) => o.id === params.id);
	if (!org) error(404, 'Organization not found');
	const role = (await orgRole(locals.user.id, params.id)) ?? 'member';
	const isManager = role === 'owner' || role === 'admin';

	const [members, invitations] = await Promise.all([
		listMembers(params.id),
		isManager ? listPendingInvitations(params.id) : Promise.resolve([])
	]);

	return {
		org: { id: org.id, name: org.name, slug: org.slug },
		role,
		isManager,
		isOwner: role === 'owner',
		currentUserId: locals.user.id,
		members,
		invitations
	};
};

export const actions: Actions = {
	rename: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const name = String((await request.formData()).get('name') ?? '');
		const res = await updateOrganizationService(locals.user.id, params.id, { name });
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	invite: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		const role = String(form.get('role') ?? 'member');
		const res = await inviteMemberService(locals.user.id, params.id, email, role);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { invited: true, createdInviteId: res.data.id };
	},

	cancelInvite: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const invitationId = String((await request.formData()).get('invitationId') ?? '');
		const res = await cancelInvitationService(locals.user.id, invitationId);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	updateRole: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const role = String(form.get('role') ?? '');
		const res = await updateMemberRoleService(locals.user.id, params.id, userId, role);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	removeMember: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const userId = String((await request.formData()).get('userId') ?? '');
		const res = await removeMemberService(locals.user.id, params.id, userId);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	leave: async ({ params, locals, cookies }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const res = await leaveOrgService(locals.user.id, params.id);
		if (!res.ok) return fail(res.status, { message: res.message });
		// leaving the active org: drop its cookies so the shell re-resolves another
		// org (or /onboarding if none remain).
		cookies.delete('org', { path: '/' });
		cookies.delete('workspace', { path: '/' });
		redirect(303, '/projects');
	},

	deleteOrg: async ({ params, locals, cookies }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const res = await deleteOrganizationGuarded(params.id, locals.user.id);
		if (!res.ok) return fail(res.status, { message: res.message });
		cookies.delete('org', { path: '/' });
		cookies.delete('workspace', { path: '/' });
		redirect(303, '/projects');
	}
};
