/**
 * The sidebar's icon set — one hand, one weight, one grid.
 *
 * WHY NOT EMOJI (what was there before)
 *
 * Emoji are pictures drawn by the operating system: Windows, macOS and Android
 * each render a different 🗓, at a different visual size, in colours no theme
 * can touch. Nineteen of them stacked in a sidebar look like nineteen stickers
 * from nineteen sheets — the exact "lộn xộn, giống AI" the owner named. Every
 * serious product (Fresha, Linear, KiotViet) draws its nav icons as line art
 * in ONE stroke weight that inherits `currentColor`, so the icon obeys the
 * theme, the hover state and the active state like text does.
 *
 * WHY HAND-DRAWN AND NOT A LIBRARY
 *
 * lucide-react would be the normal answer, but it is not in the dependency
 * tree and the icons below are 24×24 outlines a few paths each — cheaper to
 * own than to add a package for. All on the same 24 grid, stroke 1.7, round
 * caps, so they read as one family.
 */

const P: Record<string, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 8.8V21h13V8.8" /><path d="M9.5 21v-6h5v6" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M3.5 10h17M8 2.8V7M16 2.8V7" /></>,
  calendarCheck: <><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M3.5 10h17M8 2.8V7M16 2.8V7" /><path d="m8.8 15.3 2.2 2.2 4.2-4.3" /></>,
  walk: <><circle cx="13" cy="4.5" r="2" /><path d="M10 20.5 12 15l-2-3 1-5 4 2 3 1.5" /><path d="m12 15 3 2 1 3.5M10 9.5 7 12l-2 1" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12L16 12h5" />,
  utensils: <><path d="M7 3v7c0 1.2-.9 2-2 2s-2-.8-2-2V3M5 12v9" /><path d="M14 3v18M14 3c3 0 5 2.5 5 6v4h-5" /></>,
  bowl: <><path d="M4 12h16a8 8 0 0 1-16 0Z" /><path d="M9 8c0-1.5 1-1.5 1-3M14 8c0-1.5 1-1.5 1-3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.2l3.4 2" /></>,
  receipt: <><path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21V3Z" /><path d="M9.5 8h5M9.5 12h5" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="16.5" rx="2" /><path d="M9 4.5a3 3 0 0 1 6 0M9 10.5h6M9 14.5h6" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M15.5 5.8a3.2 3.2 0 0 1 0 5.9M17 14.8c2.1.6 3.5 2.3 3.5 4.7" /></>,
  sparkle: <><path d="M12 4l1.8 4.6L18.5 10l-4.7 1.7L12 16.5l-1.8-4.8L5.5 10l4.7-1.4L12 4Z" /><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" /></>,
  bag: <><path d="M5.5 8h13l-1 13h-11l-1-13Z" /><path d="M9 10.5V6.8a3 3 0 0 1 6 0v3.7" /></>,
  gift: <><rect x="4" y="10" width="16" height="11" rx="1.5" /><path d="M4 13.5h16M12 10v11M12 10c-4.5 0-5.5-2-5.5-3.5a2 2 0 0 1 4-.5c.4.9 1 2.4 1.5 4 .5-1.6 1.1-3.1 1.5-4a2 2 0 0 1 4 .5C17.5 8 16.5 10 12 10Z" /></>,
  scissors: <><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="6.5" cy="17.5" r="2.5" /><path d="m8.7 8 11.8 8.5M8.7 16 20.5 7.5" /></>,
  chair: <><path d="M6.5 12V5.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2V12" /><path d="M4.5 15.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v2h-15v-2ZM6 17.5v3M18 17.5v3" /></>,
  megaphone: <><path d="M4 10.5v3.5h3l7.5 4.5v-13L7 10H4Z" /><path d="M18 9.5a4 4 0 0 1 0 5.5M7.5 14.5 9 20" /></>,
  chart: <><path d="M4 20.5h16.5" /><path d="M7 20.5V12M12 20.5V6.5M17 20.5V9.5" /></>,
  pie: <><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12V3.5Z" /><path d="M15 3.9A8.5 8.5 0 0 1 20.1 9H15V3.9Z" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13.5" rx="2" /><path d="m4.5 7.5 7.5 6 7.5-6" /></>,
  star: <path d="m12 3.8 2.6 5.2 5.8.8-4.2 4.1 1 5.7-5.2-2.7-5.2 2.7 1-5.7L3.6 9.8l5.8-.8L12 3.8Z" />,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.3 12.2 2.5 2.6 4.9-5.4" /></>,
  chat: <path d="M4 5.5h16v11H10l-4.5 4v-4H4v-11Z" />,
  inboxTray: <><path d="M4 4.5h16V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V4.5Z" /><path d="M4 13h4.5c0 1.6 1.5 3 3.5 3s3.5-1.4 3.5-3H20" /></>,
  bot: <><rect x="4.5" y="8" width="15" height="11" rx="3" /><path d="M12 8V4.5M12 4.5a1.3 1.3 0 1 0-.01 0Z" /><circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" /><path d="M9.5 16.2h5" /></>,
  phone: <path d="M5 4.5C5 3.7 5.7 3 6.5 3h2L10 7.5 8 9c.9 2.4 2.7 4.2 5 5l1.5-2 4.5 1.5v2c0 .8-.7 1.5-1.5 1.5C10 17 7 14 5 6.5v-2Z" />,
  dollar: <><circle cx="12" cy="12" r="8.5" /><path d="M15 9.3c-.5-1-1.6-1.6-3-1.6-1.7 0-2.8.9-2.8 2.1 0 3 6 1.5 6 4.4 0 1.3-1.3 2.2-3.2 2.2-1.5 0-2.7-.7-3.2-1.7M12 6.2v11.6" /></>,
  card: <><rect x="3.5" y="6" width="17" height="12.5" rx="2" /><path d="M3.5 10h17M7 15h4" /></>,
  fileText: <><path d="M6.5 3h8L19 7.5V21h-12.5V3Z" /><path d="M14 3v5h5M9.5 12h5M9.5 15.5h5" /></>,
  trendUp: <><path d="M4 18.5 10 12l3.5 3.5L20 9" /><path d="M15.5 9H20v4.5" /></>,
  banknote: <><rect x="3.5" y="7" width="17" height="10.5" rx="1.8" /><circle cx="12" cy="12.2" r="2.4" /><path d="M6.5 10v.01M17.5 14.4v.01" /></>,
  box: <><path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2L12 3Z" /><path d="m4.3 7.5 7.7 4 7.7-4M12 11.5V21" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 2H4.2l1.8-2Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  puzzle: <path d="M10 4.5a1.8 1.8 0 1 1 3.6 0H17a1.5 1.5 0 0 1 1.5 1.5v3.2a1.8 1.8 0 1 0 0 3.6V16a1.5 1.5 0 0 1-1.5 1.5h-3.2a1.8 1.8 0 1 0-3.6 0H7A1.5 1.5 0 0 1 5.5 16v-3.4a1.8 1.8 0 1 1 0-3.6V6A1.5 1.5 0 0 1 7 4.5h3Z" />,
  plug: <><path d="M9 3.5V8M15 3.5V8" /><path d="M6.5 8h11v3.5A5.5 5.5 0 0 1 12 17a5.5 5.5 0 0 1-5.5-5.5V8ZM12 17v4" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" /></>,
  trash: <><path d="M5 6.5h14M9.5 6.5V4.5h5v2M7 6.5 8 21h8l1-14.5" /><path d="M10.2 10.5v6.5M13.8 10.5v6.5" /></>,
};

export function NavIcon({ name, size = 17 }: { name: string; size?: number }) {
  const paths = P[name] ?? P.gear;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ flexShrink: 0, display: 'block' }}>
      {paths}
    </svg>
  );
}
