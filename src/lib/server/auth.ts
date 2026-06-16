import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor, admin } from 'better-auth/plugins';
import { env } from '$env/dynamic/private';
import { db } from './db';
import * as schema from './db/schema';

export const auth = betterAuth({
	appName: 'Baskets',
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:5173',
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
		minPasswordLength: 8
	},
	plugins: [
		twoFactor({
			issuer: 'Baskets'
		}),
		admin()
	]
});
