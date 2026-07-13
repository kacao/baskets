import { createAuthClient } from 'better-auth/svelte';
import { twoFactorClient, adminClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [twoFactorClient(), adminClient()]
});
