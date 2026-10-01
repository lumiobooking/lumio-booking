'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLang } from '../../lib/i18n';

interface Mine {
  visible: boolean;
  answers?: number; happy?: number; pct?: number | null; google?: number;
  reasons?: { reason: string; count: number }[] | null;
  board?: { name: string; pct: number | null; answers: number; me: boolean }[] | null;
}

const REASON_VI: Record<string, string> = {
  'Waited too long': 'Chờ quá lâu', 'Service quality': 'Chất lượng dịch vụ', 'Polish chipped': 'Sơn bị bong',
  'Staff attitude': 'Thái độ nhân viên', Cleanliness: 'Vệ sinh', Price: 'Giá cả', Other: 'Khác',
};

/**
 * A technician's own feedback numbers, in the staff app. Only what the owner
 * switched on in Feedback → Settings, and never a customer's name or phone.
 */
export function MyFeedbackCard({ token }: { token: string | null }) {
  const { lang } = useLang();
  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const [d, setD] = useState<Mine | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<Mine>('/feedback/me', { token }).then((x) => { if (alive) setD(x); }).catch(() => undefined);
    return () => { alive = false; };
  }, [token]);

  if (!d || !d.visible) return null;
  const pct = d.pct ?? null;
  const reasons = d.reasons ?? [];
  const max = Math.max(1, ...reasons.map((r) => r.count));

  return (
    <div style={{ background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 16, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: 'var(--c94a3b8)' }}>{L('KHÁCH NÓI GÌ VỀ BẠN · 30 NGÀY', 'WHAT CUSTOMERS SAID · LAST 30 DAYS')}</div>
      <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 800, color: pct == null ? 'var(--ce2e8f0)' : pct >= 90 ? 'var(--ink-good)' : 'var(--ink-warn)' }}>{pct == null ? '—' : `${pct}%`}</div>
          <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(`hài lòng · ${d.answers ?? 0} câu trả lời`, `happy · ${d.answers ?? 0} answers`)}</div>
        </div>
        <div>
          <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{d.google ?? 0}</div>
          <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('khách đã lên Google', 'went on to Google')}</div>
        </div>
      </div>
      {reasons.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', fontWeight: 600 }}>{L('Điều khách muốn bạn làm tốt hơn', 'What customers want you to improve')}</div>
          {reasons.map((r) => (
            <div key={r.reason}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 5, color: 'var(--ccbd5e1)' }}><span>{lang === 'vi' ? REASON_VI[r.reason] ?? r.reason : r.reason}</span><b>{r.count}</b></div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--c334155)' }}><div style={{ height: '100%', width: `${(r.count / max) * 100}%`, borderRadius: 4, background: '#6366f1' }} /></div>
            </div>
          ))}
        </div>
      )}
      {d.board && d.board.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', fontWeight: 600, marginBottom: 8 }}>{L('Bảng xếp hạng của tiệm', 'Team board')}</div>
          {d.board.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 10, fontSize: 14, background: b.me ? 'var(--c1e1b4b)' : 'transparent', color: b.me ? 'var(--ca5b4fc)' : 'var(--ccbd5e1)', fontWeight: b.me ? 700 : 500 }}>
              <span style={{ width: 22, color: 'var(--c94a3b8)' }}>{i + 1}</span>
              <span style={{ flex: 1 }}>{b.name}{b.me ? L(' (bạn)', ' (you)') : ''}</span>
              <span>{b.pct == null ? '—' : `${b.pct}%`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
