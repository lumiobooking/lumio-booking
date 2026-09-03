'use client';

/**
 * The opening assessment of one salon, for the person who will hand it over.
 *
 * WHAT THIS SCREEN IS FOR
 *
 * Lumio reads it, decides whether it is worth sending, and copies it out. It is
 * deliberately not emailed to the salon on its own: a report built on almost no
 * data reads exactly like a report built on plenty, and the only defence against
 * that is a person looking at the confidence line before it leaves the building.
 *
 * SO THE CONFIDENCE LINE IS THE LOUDEST THING ON THE PAGE.
 *
 * A thin report is banded red and says so in its own words. Everything below it
 * is split into two columns that never blur: what was measured, each with the
 * source that produced it, and what could not be seen, each with what it costs
 * and the one action that would fix it. There is no middle column, because the
 * middle column is where a report starts lying.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

type Confidence = 'thin' | 'partial' | 'solid';

interface Fact { label: string; value: string; source: string }
interface Gap { label: string; cost: string; unlock: string }
interface Week { week: number; focus: string; minutes: number; tasks: { id: string; title: string; minutes: number; track: string }[] }
interface Report {
  shopName: string; trade: string; where: string;
  confidence: Confidence; confidenceNote: string;
  known: Fact[]; unknowns: Gap[];
  start: { measured: number; unknown: number; failing: number; verdict: string };
  keywords: { primary: string[]; pages: number };
  firstMonth: Week[];
  promise: string; caveat: string;
  en?: Report;
}

const BAND: Record<Confidence, { fg: string; bg: string; label: string; icon: string }> = {
  solid:   { fg: '#22c55e', bg: 'rgba(34,197,94,.10)',  label: 'Dữ liệu đủ — gửi được', icon: '✓' },
  partial: { fg: '#f59e0b', bg: 'rgba(245,158,11,.10)', label: 'Dữ liệu một phần — đọc kỹ trước khi gửi', icon: '!' },
  thin:    { fg: '#ef4444', bg: 'rgba(239,68,68,.10)',  label: 'Gần như chưa có dữ liệu — chưa nên gửi', icon: '✕' },
};

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** The report as plain text, for pasting into an email or a Zalo message. */
function asText(r: Report): string {
  const L: string[] = [];
  L.push(`ĐÁNH GIÁ KHỞI ĐẦU — ${r.shopName}`);
  L.push(`${r.trade} · ${r.where}`);
  L.push('');
  L.push('NHỮNG GÌ ĐÃ ĐỌC ĐƯỢC');
  const known = Array.isArray(r.known) ? r.known : [];
  if (known.length) for (const k of known) L.push(`• ${k.label}: ${k.value}  (${k.source})`);
  else L.push('• Chưa đọc được gì về tiệm này.');
  L.push('');
  L.push('NHỮNG GÌ CHƯA NHÌN THẤY ĐƯỢC');
  for (const u of r.unknowns ?? []) L.push(`• ${u.label}\n  Hệ quả: ${u.cost}\n  Cách mở: ${u.unlock}`);
  L.push('');
  L.push(`ĐIỂM KHỞI ĐẦU: ${r.start?.verdict ?? '—'}`);
  L.push('');
  L.push('THÁNG ĐẦU TIÊN');
  for (const w of r.firstMonth ?? []) {
    L.push(`Tuần ${w.week} — ${w.focus} (${w.minutes} phút)`);
    for (const t of w.tasks ?? []) L.push(`  ${t.track === 'map' ? '📍' : '🔍'} ${t.title} (${t.minutes}p)`);
  }
  L.push('');
  L.push(`THỜI GIAN: ${r.promise}`);
  L.push('');
  L.push(`LƯU Ý: ${r.caveat}`);
  return L.join('\n');
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ ...ui.card, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{title}</div>
      {note && <div style={{ fontSize: 12.5, color: 'var(--c64748b)', lineHeight: 1.6, marginTop: 4 }}>{note}</div>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

export function OnboardingReport({ token }: { token: string | null }) {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { setR(await apiFetch<Report>('/content/onboarding', { token })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Không tải được'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* a browser that refuses the clipboard is not worth a red box */ }
  };

  if (err) return <div style={{ ...ui.card, padding: 16, color: '#ef4444', fontSize: 13.5 }}>{err}</div>;
  if (!r) return <div style={{ fontSize: 13, color: 'var(--c64748b)', padding: '18px 0' }}>Đang dựng bản đánh giá…</div>;

  // Every list below is iterated. A server on an older shape must produce a
  // sentence rather than a stack trace, and the sentence has to name the cause
  // — a spinner that never resolves is the version of this nobody reports.
  const known = Array.isArray(r.known) ? r.known : [];
  const gaps = Array.isArray(r.unknowns) ? r.unknowns : [];
  const weeks = Array.isArray(r.firstMonth) ? r.firstMonth : [];
  const terms = Array.isArray(r.keywords?.primary) ? r.keywords.primary : [];
  const band = BAND[r.confidence] ?? BAND.thin;

  return (
    <>
      {/* ---- how much of this is real. First, and loudest. ---- */}
      <div style={{ ...ui.card, padding: 16, marginBottom: 14, borderColor: band.fg, background: band.bg }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: band.fg, color: '#0f172a', fontSize: 15, fontWeight: 800,
          }}>{band.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: band.fg }}>{band.label}</div>
            <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginTop: 5 }}>{r.confidenceNote}</div>
          </div>
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--c1e293b)', display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{r.shopName}</div>
            <div style={{ fontSize: 12.5, color: 'var(--c64748b)', marginTop: 2 }}>{r.trade} · {r.where}</div>
          </div>
          <button
            onClick={() => copy(asText(r))}
            style={{
              background: copied ? 'rgba(34,197,94,.14)' : 'var(--c0f172a)',
              border: `1px solid ${copied ? '#22c55e' : 'var(--c334155)'}`, borderRadius: 9,
              padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 600, color: copied ? '#22c55e' : 'var(--ccbd5e1)',
            }}
          >{copied ? '✓ Đã chép — dán vào email hoặc Zalo' : 'Chép bản này để gửi khách'}</button>
        </div>
      </div>

      {/* ---- what we could see ---- */}
      <Section
        title={`✓ Đã đọc được — ${known.length} mục`}
        note="Mỗi dòng kèm nguồn. Dòng nào không có nguồn thì không phải sự thật, nó là phỏng đoán, và ở đây không có phỏng đoán."
      >
        {known.length === 0 ? (
          <div style={{ fontSize: 13, color: '#ef4444', lineHeight: 1.6 }}>
            Chưa đọc được gì về tiệm này. Toàn bộ phần dưới là khung chuẩn của ngành, không phải phân tích riêng.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {known.map((k, i) => (
              <div key={i} style={{ padding: '10px 12px', borderRadius: 9, background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)' }}>
                <div style={{ fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--c64748b)' }}>{k.label}</div>
                <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.55, marginTop: 3 }}>{k.value}</div>
                <div style={{ fontSize: 11.5, color: '#22c55e', marginTop: 4 }}>↳ {k.source}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ---- what we could not ---- */}
      <Section
        title={`✕ Chưa nhìn thấy được — ${gaps.length} mục`}
        note="Đây là danh sách việc bán hàng thật sự: mỗi dòng là một thứ đang che mắt hệ thống, và mỗi dòng có đúng một cách mở."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {gaps.map((u, i) => (
            <div key={i} style={{ padding: '11px 12px', borderRadius: 9, background: 'var(--c0f172a)', border: '1px solid var(--c334155)' }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#f59e0b', lineHeight: 1.4 }}>{u.label}</div>
              <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.6, marginTop: 5 }}>{u.cost}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55, marginTop: 6, paddingLeft: 10, borderLeft: '2px solid #38bdf8' }}>
                <b style={{ color: '#38bdf8' }}>Cách mở:</b> {u.unlock}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ---- the starting point ---- */}
      <Section title="Điểm khởi đầu">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            { n: r.start?.measured ?? 0, l: 'đo được', c: '#22c55e' },
            { n: r.start?.failing ?? 0, l: 'đang hỏng', c: '#ef4444' },
            { n: r.start?.unknown ?? 0, l: 'chưa thấy', c: '#f59e0b' },
          ].map((x) => (
            <div key={x.l} style={{ flex: '1 1 100px', padding: '10px 12px', borderRadius: 9, background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)' }}>
              <div style={{ fontFamily: mono, fontSize: 22, fontWeight: 700, color: x.c }}>{x.n}</div>
              <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 2 }}>{x.l}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.6 }}>{r.start?.verdict}</div>
      </Section>

      {/* ---- keywords ---- */}
      <Section title={`Từ khoá mục tiêu — ${r.keywords?.pages ?? 0} trang cần dựng`}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {terms.map((k, i) => (
            <span key={i} style={{
              fontFamily: mono, fontSize: 11.5, color: 'var(--ce2e8f0)',
              background: 'rgba(56,189,248,.12)', border: '1px solid #38bdf8',
              borderRadius: 6, padding: '3px 8px',
            }}>{k}</span>
          ))}
        </div>
      </Section>

      {/* ---- the first month ---- */}
      <Section title="Tháng đầu tiên" note="Chia theo tuần, mỗi tuần dưới khoảng 3 tiếng — vừa đủ để một chủ tiệm làm thật chứ không phải đọc rồi bỏ.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {weeks.map((w) => (
            <div key={w.week} style={{ padding: '11px 12px', borderRadius: 9, background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ca5b4fc)' }}>Tuần {w.week} — {w.focus}</span>
                <span style={{ fontFamily: mono, fontSize: 11.5, color: 'var(--c64748b)' }}>{w.minutes} phút</span>
              </div>
              {w.tasks.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--c64748b)', marginTop: 6 }}>Hết việc một lần — từ tuần này là các việc lặp lại.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
                  {w.tasks.map((t) => (
                    <div key={t.id} style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.5 }}>
                      <span style={{ color: t.track === 'map' ? '#6366f1' : '#38bdf8', marginRight: 6 }}>{t.track === 'map' ? '📍' : '🔍'}</span>
                      {t.title}
                      <span style={{ fontSize: 11.5, color: 'var(--c64748b)', marginLeft: 6 }}>≈{t.minutes}p</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ---- the promise, and the limits of it ---- */}
      <Section title="Thời gian">
        <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.65 }}>{r.promise}</div>
      </Section>

      <div style={{
        ...ui.card, padding: 14, borderColor: '#f59e0b', background: 'rgba(245,158,11,.07)',
        fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.65,
      }}>
        <b style={{ color: '#f59e0b' }}>Bản này không phải audit đầy đủ.</b> {r.caveat}
      </div>
    </>
  );
}
