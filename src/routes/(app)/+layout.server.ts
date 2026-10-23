import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { attentionCount } from '#lib/server/services/plans.ts';
import type { LayoutServerLoad } from './$types';

// Guards every page in (app). Form actions still call requireUser() themselves (CLAUDE.md).
export const load: LayoutServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	return {
		user: { name: user.name, email: user.email, role: user.role },
		// Red badge on "Strategi": late + due-today steps assigned to this user
		strategyCount: await attentionCount(db, user.id)
	};
};
