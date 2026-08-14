/**
 * Which locale dates, times and numbers should be rendered in.
 *
 * Every screen used to hardcode 'en-US', which quietly assumes American date
 * order. `8/12/2026` reads as 8 December to a Vietnamese user and 12 August to
 * an American one, and nothing on screen says which is meant — an appointment
 * can sit four months out of place with everyone believing they read it right.
 *
 * The language the person picked in the header is the answer, and it already
 * lives in localStorage, so this can be read from plain helper functions as
 * well as components without threading a prop through every call site.
 *
 * On the server there is no localStorage and no person, so it answers 'en-US' —
 * exactly what the code did before — which also keeps server and client markup
 * identical during hydration.
 */
export function uiLocale(): string {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('lumio_lang') === 'vi'
      ? 'vi-VN'
      : 'en-US';
  } catch {
    return 'en-US';
  }
}
