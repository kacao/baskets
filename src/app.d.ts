import type { auth } from '$lib/server/auth';

type Session = typeof auth.$Infer.Session;

declare global {
	namespace App {
		interface Locals {
			session: Session['session'] | null;
			user: Session['user'] | null;
		}
	}
}

export {};
