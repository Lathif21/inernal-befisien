import type { Component } from 'svelte';
import type { Path } from '$app/types';
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import Target from '@lucide/svelte/icons/target';
import SquareKanban from '@lucide/svelte/icons/square-kanban';
import FolderKanban from '@lucide/svelte/icons/folder-kanban';
import Inbox from '@lucide/svelte/icons/inbox';
import Users from '@lucide/svelte/icons/users';
import Wallet from '@lucide/svelte/icons/wallet';
import FileText from '@lucide/svelte/icons/file-text';
import Settings from '@lucide/svelte/icons/settings';

/**
 * The sidebar's routes. A narrow union, not `Path`: `resolve()` with every route of the app as a
 * union argument hits TypeScript's union limit in Sidebar.svelte.
 */
export type NavHref = Extract<
	Path,
	| ''
	| 'strategy'
	| 'pipeline'
	| 'projects'
	| 'clients'
	| 'inbox'
	| 'finance'
	| 'invoices'
	| 'settings'
>;

export type NavItem = {
	label: string;
	href: NavHref;
	icon: Component<{ size?: number; strokeWidth?: number }>;
	/** Shown muted with a "Fase 2" chip until the feature ships */
	phase?: 2;
	/** Rendered at the bottom of the sidebar */
	bottom?: boolean;
	/** Strategi carries the late + due-today badge, Kotak Masuk the unread threads */
	badge?: 'strategy' | 'inbox';
};

// Order and labels from docs/03-SCREENS.md → Navigation.
// SvelteKit 3 paths have no leading slash ('' = home); render them with resolve().
export const navItems: NavItem[] = [
	{ label: 'Dashboard', href: '', icon: LayoutDashboard },
	{ label: 'Strategi', href: 'strategy', icon: Target, badge: 'strategy' },
	{ label: 'Pipeline Sales', href: 'pipeline', icon: SquareKanban },
	{ label: 'Proyek', href: 'projects', icon: FolderKanban },
	{ label: 'Klien', href: 'clients', icon: Users },
	{ label: 'Kotak Masuk', href: 'inbox', icon: Inbox, badge: 'inbox' },
	{ label: 'Keuangan', href: 'finance', icon: Wallet },
	{ label: 'Invoice', href: 'invoices', icon: FileText },
	{ label: 'Pengaturan', href: 'settings', icon: Settings, bottom: true }
];

/** `pathname` is page.url.pathname (with a leading slash) */
export function isActive(item: NavItem, pathname: string): boolean {
	if (item.href === '') return pathname === '/';
	return pathname === `/${item.href}` || pathname.startsWith(`/${item.href}/`);
}
