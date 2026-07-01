import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor, admin } from 'better-auth/plugins';
import { env } from '$env/dynamic/private';
import { db } from './db';
import * as schema from './db/schema';

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
		provider: 'sqlite',
		schema: {
			user: schema.user,
			session: schema.session,
			account: schema.account,
			verification: schema.verification,
			twoFactor: schema.twoFactor
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
		admin()
	]
});
