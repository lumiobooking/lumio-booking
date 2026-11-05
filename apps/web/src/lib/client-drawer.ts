/**
 * Open a client in the side drawer from anywhere in the salon app, instead of
 * leaving the page. A link to /salon/customers/<id> keeps working for a new tab
 * (ctrl/⌘-click, middle click) and on screens without the drawer.
 */
import type { MouseEvent } from 'react';

export const CLIENT_DRAWER_EVENT = 'lumio:client-drawer';

declare global {
  interface Window { __lumioClientDrawer?: boolean }
}

export function openClientDrawer(id: string): boolean {
  if (typeof window === 'undefined' || !window.__lumioClientDrawer || !id) return false;
  window.dispatchEvent(new CustomEvent(CLIENT_DRAWER_EVENT, { detail: { id } }));
  return true;
}

/** onClick for a client link: the drawer for a plain click, the page for a new tab. */
export function onClientLink(e: MouseEvent, id: string | null | undefined): void {
  if (!id || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (openClientDrawer(id)) e.preventDefault();
}
