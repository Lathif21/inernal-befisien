import { requireUser } from '#lib/server/guards.ts';
import type { LayoutServerLoad } from './$types';

// Guards every page in (app). Form actions still call requireUser() themselves (CLAUDE.md).
export const load: LayoutServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return { user: { name: user.name, email: user.email, role: user.role } };
};
