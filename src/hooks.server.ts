import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { API_KEY_PREFIX, resolveApiKey } from '$lib/server/api-keys';
import { ensureDefaultStatuses } from '$lib/server/statuses';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	if (!building) await ensureDefaultStatuses();

	// Bearer API key (REST clients): Authorization: Bearer bsk_...
	const authHeader = event.request.headers.get('authorization');
	if (authHeader?.startsWith('Bearer ' + API_KEY_PREFIX)) {
		const apiUser = await resolveApiKey(authHeader.slice('Bearer '.length));
		event.locals.user = (apiUser as App.Locals['user']) ?? null;
		event.locals.session = null;
		return svelteKitHandler({ event, resolve, auth, building });
	}

	// Browser session cookie
	const session = await auth.api.getSession({
		headers: event.request.headers
	});

	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;

	return svelteKitHandler({ event, resolve, auth, building });
};
