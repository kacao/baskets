import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { API_KEY_PREFIX, resolveApiKey } from '$lib/server/api-keys';
import { ensureDefaultStatuses } from '$lib/server/statuses';
import { ensureDefaultOrganization } from '$lib/server/workspaces';
import type { Handle } from '@sveltejs/kit';

const THEMES = ['light', 'dark'];

// BetterAuth organization plugin endpoints that the app does NOT use client-side
// and that leak cross-member data (ADR-062 review fix): `list-invitations` +
// `get-full-organization` hand invitation ids — the accept capability — and full
// rosters to ANY plain member (gated only on membership), defeating the app's own
// owner/admin gating and enabling escalation via a leaked admin-role invite;
// `check-slug` is a cross-tenant org-existence oracle. The app has its own gated
// equivalents (listMembers, listPendingInvitations, /invite/[id]). Block them.
const BLOCKED_AUTH_PATHS = new Set([
	'/api/auth/organization/list-invitations',
	'/api/auth/organization/get-full-organization',
	'/api/auth/organization/check-slug'
]);

export const handle: Handle = async ({ event, resolve }) => {
	if (!building) {
		await ensureDefaultStatuses();
		await ensureDefaultOrganization();
	}

	if (BLOCKED_AUTH_PATHS.has(event.url.pathname)) {
		return new Response('Not Found', { status: 404 });
	}

	// DaisyUI theme + high-contrast accessibility flag: cookie-driven, applied to
	// <html data-theme / data-contrast> at SSR (no flash)
	const cookieTheme = event.cookies.get('theme');
	const theme = cookieTheme && THEMES.includes(cookieTheme) ? cookieTheme : 'light';
	const contrastAttr = event.cookies.get('contrast') === 'high' ? ' data-contrast="high"' : '';
	const themed = (ev: typeof event) =>
		resolve(ev, {
			transformPageChunk: ({ html }) =>
				html.replace('data-theme="light"', `data-theme="${theme}"${contrastAttr}`)
		});

	// Bearer API key (REST clients): Authorization: Bearer bsk_...
	const authHeader = event.request.headers.get('authorization');
	if (authHeader?.startsWith('Bearer ' + API_KEY_PREFIX)) {
		const apiUser = await resolveApiKey(authHeader.slice('Bearer '.length));
		event.locals.user = (apiUser as App.Locals['user']) ?? null;
		event.locals.session = null;
		return svelteKitHandler({ event, resolve: themed, auth, building });
	}

	// Browser session cookie
	const session = await auth.api.getSession({
		headers: event.request.headers
	});

	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;

	return svelteKitHandler({ event, resolve: themed, auth, building });
};
