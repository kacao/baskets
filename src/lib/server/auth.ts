import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor, admin, organization } from 'better-auth/plugins';
import { env } from '$env/dynamic/private';
import { db } from './db';
import * as schema from './db/schema';
import { DIALECT } from './db/dialect';
import {
	bootstrapOrgWorkspace,
	purgeStaleGrants,
	shouldSeedSamplesForOwner,
	slugifyOrgName,
	uniqueOrgSlug
} from './orgs';
import { kickUser } from './realtime/hub';

export const auth = betterAuth({
	appName: 'Baskets',
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL || undefined,
	trustedOrigins: (env.TRUSTED_ORIGINS ?? '')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean),
	advanced: {
		useSecureCookies: process.env.NODE_ENV === 'production'
	},
	database: drizzleAdapter(db, {
		provider: DIALECT === 'postgres' ? 'pg' : 'sqlite',
		schema: {
			user: schema.user,
			session: schema.session,
			account: schema.account,
			verification: schema.verification,
			twoFactor: schema.twoFactor,
			organization: schema.organization,
			member: schema.member,
			invitation: schema.invitation
		}
	}),
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 12
	},
	// Explicit session lifetime (ADR-048): 14-day expiry, refreshed at most once
	// per active day — shorter than BetterAuth's ~30-day default.
	session: {
		expiresIn: 60 * 60 * 24 * 14,
		updateAge: 60 * 60 * 24
	},
	// Make BetterAuth's rate limiting explicit (ADR-048). It is only enabled in
	// production by default; keep that behaviour but document the window/max here.
	rateLimit: {
		enabled: process.env.NODE_ENV === 'production',
		window: 60,
		max: 100
	},
	plugins: [
		twoFactor({
			issuer: 'Baskets'
		}),
		admin(),
		// Multi-tenant organizations (ADR-062). Org roles live only on member.role;
		// teams + dynamicAccessControl stay disabled. Deletion is disabled here and
		// goes through our guarded service (deleteOrganizationGuarded, D8).
		organization({
			allowUserToCreateOrganization: true,
			creatorRole: 'owner',
			invitationExpiresIn: 604800, // seconds = 7 days (copy-link invites, D6)
			membershipLimit: 500,
			cancelPendingInvitationsOnReInvite: true,
			disableOrganizationDeletion: true,
			organizationHooks: {
				// Server-generated slug only (D1): ignore any client-supplied slug and
				// derive a unique one from the name (slug 'default' is effectively
				// reserved — the migration owns it and collisions get a numeric suffix).
				beforeCreateOrganization: async ({ organization: org }) => {
					const slug = await uniqueOrgSlug(slugifyOrgName(org.name ?? 'org'));
					return { data: { ...org, slug } };
				},
				// Reject client-driven `slug`/`metadata` changes on the live plugin
				// update endpoint (ADR-062 review fix). The slug is server-generated and
				// immutable (D1); `metadata` holds the migration marker — clearing
				// org-default's {"migrated":true} would re-trigger the boot migration's
				// full-user membership backfill. The app's own rename path
				// (updateOrganizationService) writes `name` directly and never hits this
				// hook, so nothing legitimate is blocked. (The plugin MERGES the returned
				// data over the body, so stripping-by-omission wouldn't work — reject.)
				beforeUpdateOrganization: async ({ organization: patch }) => {
					if ('slug' in patch || 'metadata' in patch)
						throw new APIError('BAD_REQUEST', {
							message: 'Organization slug and metadata cannot be changed'
						});
				},
				// Bootstrap the org's default workspace (+ sample content for a first-time
				// owner). Idempotent and non-throwing: the plugin does NOT wrap create in a
				// transaction, so a throwing hook would leave a committed org + a 500 and
				// duplicate orgs on retry.
				afterCreateOrganization: async ({ organization: org, user }) => {
					try {
						const seedSamples = await shouldSeedSamplesForOwner(user.id);
						await bootstrapOrgWorkspace(org.id, user.id, { seedSamples });
					} catch (e) {
						console.error('afterCreateOrganization: workspace bootstrap failed', e);
					}
				},
				// Removing a member (ADR-062 D1): delete their org-scoped grant rows (so a
				// re-join can't silently resurrect access) and kick their live WS sockets
				// (revoked access stops receiving pings/presence immediately).
				afterRemoveMember: async ({ user, organization: org }) => {
					try {
						await purgeStaleGrants(user.id, org.id);
						kickUser(user.id);
					} catch (e) {
						console.error('afterRemoveMember: grant purge / kick failed', e);
					}
				},
				// Joining an org (direct add OR invite accept): purge any stale same-org
				// grant rows so a departed-then-returned user starts from zero grants.
				afterAddMember: async ({ user, organization: org }) => {
					try {
						await purgeStaleGrants(user.id, org.id);
					} catch (e) {
						console.error('afterAddMember: stale grant purge failed', e);
					}
				},
				afterAcceptInvitation: async ({ user, organization: org }) => {
					try {
						await purgeStaleGrants(user.id, org.id);
					} catch (e) {
						console.error('afterAcceptInvitation: stale grant purge failed', e);
					}
				}
			}
		})
	]
});
