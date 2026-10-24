/** `auto` = 72px rail on tablets, full 240px from lg; the other two are the person's choice */
export type SidebarMode = 'auto' | 'collapsed' | 'expanded';

export const SIDEBAR_COOKIE = 'bf-sidebar';

export function sidebarMode(cookie: string | undefined): SidebarMode {
	return cookie === 'collapsed' || cookie === 'expanded' ? cookie : 'auto';
}

/** Read on the server by (app)/+layout.server.ts, so the first paint has the right width */
export function saveSidebarMode(mode: SidebarMode) {
	document.cookie = `${SIDEBAR_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
}
