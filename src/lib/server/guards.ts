import { error, redirect } from '@sveltejs/kit';
import type { AuthUser } from './auth.ts';

export type Role = 'admin' | 'sales' | 'finance';

/** Use at the top of every load / form action that needs a logged-in user. */
export function requireUser(locals: App.Locals): AuthUser {
	if (!locals.user) redirect(303, '/login');
	return locals.user;
}

/** Phase 1 only has admins, but routes call this from day one so restricted roles (P4-01) slot in. */
export function requireRole(locals: App.Locals, ...roles: Role[]): AuthUser {
	const user = requireUser(locals);
	if (!roles.includes(user.role as Role)) error(403, 'Anda tidak punya akses ke halaman ini.');
	return user;
}
