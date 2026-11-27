/**
 * rt249 — runs in <head> before the first paint. LIGHT unless this device chose
 * dark ('lumio.theme' = 'dark'). Signed-in people also get their account's
 * choice right after (ThemeSync), so a switch is never needed twice.
 */
export const THEME_BOOT_SCRIPT = "try{var t=null;try{t=localStorage.getItem('lumio.theme')}catch(e){}if(t!=='dark'){document.documentElement.dataset.theme='light';}}catch(e){}";
