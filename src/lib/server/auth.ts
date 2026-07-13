import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor, admin, organization } from 'better-auth/plugins';
import { env } from '$env/dynamic/private';
import { db } from './db';
import * as schema from './db/schema';
import { DIALECT } from './db/dialect';
import {
	bootstrapOrgWorkspace,
	shouldSeedSamplesForOwner,
	slugifyOrgName,
	uniqueOrgSlug
} from './orgs';

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
				}
			}
		})
	]
});
