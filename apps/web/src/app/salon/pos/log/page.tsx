'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { useLang } from '../../../../lib/i18n';
import { NightLog } from '../../../../components/restaurant/NightLog';
import { AlertSettings } from '../../../../components/restaurant/AlertSettings';
import { C } from '../../../../components/restaurant/rk';

/**
 * Nhật ký & Thông báo (19/11/2026): the night log for everyone at the till,
 * and — for the owner — who gets which alert on their phone.
 */
export default function NightLogPage() {
  return (
    <SalonShell>
      <Suspense fallback={null}>
        <Inner />
      </Suspense>
    </SalonShell>
  );
}

function Inner() {
  const { user } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const router = useRouter();
  const params = useSearchParams();
  const owner = user?.role === 'SALON_ADMIN';
  const tab = owner && params?.get('tab') === 'alerts' ? 'alerts' : 'log';
  const go = (t: 'log' | 'alerts') => router.replace(t === 'alerts' ? '/salon/pos/log?tab=alerts' : '/salon/pos/log');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }}>
      {owner && (
        <nav aria-label={vi ? 'Nhật ký và thông báo' : 'Log and alerts'} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 4, background: C.line, borderRadius: 12 }}>
          {(['log', 'alerts'] as const).map((t) => (
            <button key={t} type="button" onClick={() => go(t)} aria-current={tab === t ? 'page' : undefined}
              style={{ height: 40, border: 0, borderRadius: 9, background: tab === t ? C.card : 'transparent', color: tab === t ? C.ink : C.ink2, font: 'inherit', fontSize: 14, fontWeight: tab === t ? 700 : 500, cursor: 'pointer' }}>
              {t === 'log' ? (vi ? 'Nhật ký' : 'Log') : (vi ? 'Thông báo' : 'Alerts')}
            </button>
          ))}
        </nav>
      )}
      {tab === 'alerts' ? <AlertSettings /> : <NightLog />}
    </div>
  );
}
