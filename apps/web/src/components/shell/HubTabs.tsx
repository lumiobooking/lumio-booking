'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { activeTab, type NavItem } from './nav-map';

/**
 * The tab strip on top of every screen of a gathering menu entry (Orders,
 * Reports, Appointments…). The shell hands in only the tabs this person may
 * open, already named; a single tab draws nothing — a strip with one choice
 * is noise.
 *
 * `?tab=` is read through useSearchParams, which Next wants under Suspense:
 * the fallback is the same strip without the parameter, so nothing jumps.
 */
export function HubTabs({ tabs, label, ariaLabel }: { tabs: NavItem[]; label: (t: NavItem) => string; ariaLabel: string }) {
  if (tabs.length < 2) return null;
  return (
    <Suspense fallback={<Strip tabs={tabs} label={label} ariaLabel={ariaLabel} param={null} />}>
      <WithParam tabs={tabs} label={label} ariaLabel={ariaLabel} />
    </Suspense>
  );
}

function WithParam(p: { tabs: NavItem[]; label: (t: NavItem) => string; ariaLabel: string }) {
  const sp = useSearchParams();
  return <Strip {...p} param={sp?.get('tab') ?? null} />;
}

function Strip({ tabs, label, ariaLabel, param }: { tabs: NavItem[]; label: (t: NavItem) => string; ariaLabel: string; param: string | null }) {
  const pathname = usePathname() || '';
  const on = activeTab(tabs, pathname, param);
  return (
    <nav role="tablist" aria-label={ariaLabel} style={{ maxWidth: '100%', overflowX: 'auto', marginBottom: 16, WebkitOverflowScrolling: 'touch' }}>
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--c111827)', border: '1px solid var(--line)' }}>
        {tabs.map((t) => {
          const sel = t.href === on;
          return (
            <Link key={t.href} href={t.href} role="tab" aria-selected={sel}
              style={{ padding: '8px 14px', borderRadius: 9, fontSize: 13.5, fontWeight: sel ? 700 : 600, textDecoration: 'none', whiteSpace: 'nowrap',
                background: sel ? '#4f46e5' : 'transparent', color: sel ? '#fff' : 'var(--ccbd5e1)' }}>
              {label(t)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
