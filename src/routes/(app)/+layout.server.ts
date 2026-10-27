import { db } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { unreadThreadCount } from '#lib/server/services/email.ts';
import { attentionCount } from '#lib/server/services/plans.ts';
import { SIDEBAR_COOKIE, sidebarMode } from '#lib/sidebar.ts';
import type { LayoutServerLoad } from './$types';

// Guards every page in (app). Form actions still call requireUser() themselves (CLAUDE.md).
export const load: LayoutServerLoad = async ({ locals, cookies, depends }) => {
	const user = requireUser(locals);
	// A thread page refreshes the Email badge after it marked the thread read
	depends('app:inbox');
	const [strategyCount, inboxCount] = await Promise.all([
		attentionCount(db, user.id),
		unreadThreadCount(db)
	]);
	return {
		user: { name: user.name, email: user.email, role: user.role },
		sidebar: sidebarMode(cookies.get(SIDEBAR_COOKIE)),
		// Red badge on "Strategi": late + due-today steps assigned to this user
		strategyCount,
		// Badge on "Email": threads with an unread incoming email (P3-08)
		inboxCount
	};
};
