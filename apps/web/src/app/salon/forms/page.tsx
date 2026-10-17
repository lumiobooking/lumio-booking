'use client';

/**
 * /salon/forms — the salon's paperwork: intake, cupping / hot stone consent
 * and the therapist's SOAP note. Which forms are asked, how long a signature
 * lasts, which services need which consent, the salon's own extra intake
 * questions, texting the link before a visit — and the newest signed forms.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { ui } from '../../../lib/ui';
import { kindLabel, type Answers, type FormKind, type TemplatePair } from '../../../lib/client-forms';
import { FormRenderer, THEMED } from '../../../components/forms/FormRenderer';
import { EntryViewer, FormModal } from '../../../components/forms/FormModal';

type Consent = 'cupping' | 'hot_stone';
interface Rule { enabled: boolean; serviceIds: string[]; categoryIds: string[] }
interface Settings {
  enabled: boolean; intakeRequired: boolean; intakeValidMonths: number;
  consents: Record<Consent, Rule>; consentValidMonths: number; soapRequired: boolean;
  autoSend: { enabled: boolean; hoursBefore: number };
  extraQuestions: { id: string; vi: string; en: string; flag: boolean }[];
}
interface View { settings: Settings; industry: string; access: 'full' | 'tech' | 'desk'; services: { id: string; name: string; categoryId: string | null }[] }
interface Recent { id: string; kind: FormKind; signedAt: string; signerRole: string; customerId: string | null; customerName: string | null; staffName: string | null }

const KEYWORD: Record<Consent, RegExp> = { cupping: /cupp|gi[áa]c\s*h[ơo]i/i, hot_stone: /hot\s*-?\s*stones?|đá\s*nóng|da\s*nong/i };

export default function FormsPage() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [view, setView] = useState<View | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [templates, setTemplates] = useState<TemplatePair[]>([]);
  const [preview, setPreview] = useState<FormKind | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<Answers>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<View>('/client-forms/settings', { token }).then((v) => { setView(v); setS(v.settings); }).catch((e) => setErr(e instanceof Error ? e.message : 'Error'));
    apiFetch<{ templates: TemplatePair[] }>('/client-forms/templates', { token }).then((r) => setTemplates(r.templates)).catch(() => undefined);
    apiFetch<Recent[]>('/client-forms/recent', { token }).then(setRecent).catch(() => setRecent([]));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const canEdit = view?.access === 'full';
  const patch = (p: Partial<Settings>) => { setS((x) => (x ? { ...x, ...p } : x)); setSaved(false); };
  const patchRule = (k: Consent, p: Partial<Rule>) => s && patch({ consents: { ...s.consents, [k]: { ...s.consents[k], ...p } } });

  const save = async () => {
    if (!s) return;
    setBusy(true); setErr(null);
    try {
      const next = await apiFetch<Settings>('/client-forms/settings', { method: 'PATCH', token, body: s });
      setS(next); setSaved(true);
      apiFetch<{ templates: TemplatePair[] }>('/client-forms/templates', { token }).then((r) => setTemplates(r.templates)).catch(() => undefined);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };

  const toggle = (on: boolean, onChange: (v: boolean) => void, label: string, hint?: string) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', cursor: canEdit ? 'pointer' : 'default' }}>
      <input type="checkbox" checked={on} disabled={!canEdit} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
      <span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2 }}>{hint}</span>}
      </span>
    </label>
  );
  const months = (v: number, onChange: (n: number) => void) => (
    <select value={v} disabled={!canEdit} onChange={(e) => onChange(Number(e.target.value))} style={{ ...ui.input, width: 'auto', minWidth: 160 }}>
      <option value={0}>{vi ? 'Mỗi lần đến' : 'Every visit'}</option>
      {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{vi ? `${m} tháng` : `${m} months`}</option>)}
    </select>
  );
  const h2 = (t: string) => <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ce2e8f0)', marginBottom: 4 }}>{t}</div>;

  if (!s || !view) {
    return <div style={{ padding: 24, color: err ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>{err ?? (vi ? 'Đang tải…' : 'Loading…')}</div>;
  }

  const previewTpl = preview ? templates.find((t) => t.kind === preview)?.[vi ? 'vi' : 'en'] ?? null : null;

  return (
    <div style={{ padding: '20px 16px 60px', maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ce2e8f0)', margin: 0 }}>{vi ? 'Phiếu khách hàng' : 'Client forms'}</h1>
      <p style={{ fontSize: 14, color: 'var(--c94a3b8)', margin: '6px 0 16px', lineHeight: 1.5 }}>
        {vi
          ? 'Phiếu thông tin & cam kết khách ký trước khi làm (giác hơi, đá nóng), ghi chú SOAP kỹ thuật viên ký sau khi làm. Chỉ cần chạm để chọn — lưu theo từng khách, từng thợ, từng lần đến.'
          : 'Intake and consent the client signs before the session (cupping, hot stone), and the SOAP note the therapist signs after. All tap-to-answer — kept per client, per therapist, per visit.'}
      </p>
      {!canEdit && <div style={{ ...ui.banner, marginBottom: 12 }}>{vi ? 'Chỉ chủ tiệm hoặc quản lý đổi được cài đặt này.' : 'Only the owner or a manager can change these settings.'}</div>}

      <div style={{ ...ui.card, marginBottom: 14 }}>
        {toggle(s.enabled, (v) => patch({ enabled: v }), vi ? 'Bật phiếu khách hàng cho tiệm' : 'Use client forms in this salon',
          vi ? 'Tắt thì không màn hình nào hiện phần phiếu.' : 'Off: no screen shows any forms.')}
      </div>

      {s.enabled && (
        <>
          <div style={{ ...ui.card, marginBottom: 14 }}>
            {h2(`1 · ${kindLabel('intake', vi)}`)}
            {toggle(s.intakeRequired, (v) => patch({ intakeRequired: v }), vi ? 'Khách cần ký phiếu thông tin trước buổi làm' : 'Clients sign the intake before their session')}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14, color: 'var(--ccbd5e1)' }}>
              {vi ? 'Ký lại sau' : 'Sign again after'} {months(s.intakeValidMonths, (n) => patch({ intakeValidMonths: n }))}
              <button type="button" onClick={() => { setPreviewAnswers({}); setPreview('intake'); }} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--line-strong)', color: 'var(--ce2e8f0)' }}>{vi ? 'Xem mẫu' : 'Preview'}</button>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)', marginBottom: 6 }}>{vi ? 'Câu hỏi riêng của tiệm (Có / Không)' : 'Your own questions (Yes / No)'}</div>
              {s.extraQuestions.map((q, i) => (
                <div key={q.id || i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <input value={q.vi} disabled={!canEdit} placeholder="Tiếng Việt" maxLength={160} onChange={(e) => patch({ extraQuestions: s.extraQuestions.map((x, j) => (j === i ? { ...x, vi: e.target.value } : x)) })} style={{ ...ui.input, flex: '1 1 200px' }} />
                  <input value={q.en} disabled={!canEdit} placeholder="English" maxLength={160} onChange={(e) => patch({ extraQuestions: s.extraQuestions.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)) })} style={{ ...ui.input, flex: '1 1 200px' }} />
                  <label style={{ fontSize: 12, color: 'var(--c94a3b8)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={q.flag} disabled={!canEdit} onChange={(e) => patch({ extraQuestions: s.extraQuestions.map((x, j) => (j === i ? { ...x, flag: e.target.checked } : x)) })} />
                    {vi ? '“Có” = báo thợ' : '“Yes” alerts the therapist'}
                  </label>
                  {canEdit && <button type="button" onClick={() => patch({ extraQuestions: s.extraQuestions.filter((_, j) => j !== i) })} style={{ ...ui.dangerBtn }}>{vi ? 'Xoá' : 'Remove'}</button>}
                </div>
              ))}
              {canEdit && s.extraQuestions.length < 20 && (
                <button type="button" onClick={() => patch({ extraQuestions: [...s.extraQuestions, { id: '', vi: '', en: '', flag: true }] })}
                  style={{ background: 'transparent', border: '1px dashed var(--line-strong)', color: 'var(--ink-link)', borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  + {vi ? 'Thêm câu hỏi' : 'Add a question'}
                </button>
              )}
            </div>
          </div>

          <div style={{ ...ui.card, marginBottom: 14 }}>
            {h2(`2 · ${vi ? 'Cam kết đồng ý' : 'Consent'}`)}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14, color: 'var(--ccbd5e1)', margin: '4px 0 8px' }}>
              {vi ? 'Ký lại sau' : 'Sign again after'} {months(s.consentValidMonths, (n) => patch({ consentValidMonths: n }))}
            </div>
            {(['cupping', 'hot_stone'] as Consent[]).map((k) => {
              const rule = s.consents[k];
              const ticked = rule.serviceIds.length > 0;
              const auto = view.services.filter((sv) => KEYWORD[k].test(sv.name));
              return (
                <div key={k} style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {toggle(rule.enabled, (v) => patchRule(k, { enabled: v }), kindLabel(k, vi))}
                    <button type="button" onClick={() => { setPreviewAnswers({}); setPreview(k); }} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--line-strong)', color: 'var(--ce2e8f0)' }}>{vi ? 'Xem mẫu' : 'Preview'}</button>
                  </div>
                  {rule.enabled && (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 6 }}>
                        {ticked
                          ? (vi ? 'Chỉ các dịch vụ đã chọn dưới đây cần ký.' : 'Only the services ticked below need it.')
                          : (vi ? `Chưa chọn dịch vụ: tự nhận theo tên (${auto.length ? auto.map((x) => x.name).join(', ') : 'chưa có dịch vụ nào khớp'}).` : `Nothing ticked: matched by name (${auto.length ? auto.map((x) => x.name).join(', ') : 'no service matches yet'}).`)}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                        {view.services.map((sv) => {
                          const on = rule.serviceIds.includes(sv.id);
                          return (
                            <button key={sv.id} type="button" disabled={!canEdit}
                              onClick={() => patchRule(k, { serviceIds: on ? rule.serviceIds.filter((x) => x !== sv.id) : [...rule.serviceIds, sv.id] })}
                              style={on
                                ? { background: '#6366f1', color: '#fff', border: '1px solid #6366f1', borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
                                : { background: 'transparent', color: 'var(--ccbd5e1)', border: '1px solid var(--line-strong)', borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                              {on ? '✓ ' : ''}{sv.name}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ ...ui.card, marginBottom: 14 }}>
            {h2(`3 · ${kindLabel('soap', vi)}`)}
            {toggle(s.soapRequired, (v) => patch({ soapRequired: v }), vi ? 'Kỹ thuật viên ghi & ký SOAP sau mỗi buổi' : 'The therapist writes and signs a SOAP note after each session',
              vi ? 'Hiện nút “Ghi SOAP” trên app thợ và trên phiếu khách ở quầy.' : 'Shows “Write SOAP” in the staff app and on the desk ticket.')}
            <button type="button" onClick={() => { setPreviewAnswers({}); setPreview('soap'); }} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--line-strong)', color: 'var(--ce2e8f0)' }}>{vi ? 'Xem mẫu' : 'Preview'}</button>
          </div>

          <div style={{ ...ui.card, marginBottom: 14 }}>
            {h2(`4 · ${vi ? 'Gửi link trước buổi hẹn' : 'Send the link before the visit'}`)}
            {toggle(s.autoSend.enabled, (v) => patch({ autoSend: { ...s.autoSend, enabled: v } }), vi ? 'Tự nhắn SMS link ký cho khách đặt lịch còn thiếu phiếu' : 'Text the signing link to booked clients with forms missing',
              vi ? 'Mỗi lịch hẹn chỉ nhắn 1 lần. Tốn 1 tin SMS.' : 'Once per booking. Uses one text.')}
            {s.autoSend.enabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ccbd5e1)' }}>
                {vi ? 'Trước giờ hẹn' : 'Before the visit'}
                <select value={s.autoSend.hoursBefore} disabled={!canEdit} onChange={(e) => patch({ autoSend: { ...s.autoSend, hoursBefore: Number(e.target.value) } })} style={{ ...ui.input, width: 'auto' }}>
                  {[2, 6, 12, 24, 48].map((h) => <option key={h} value={h}>{h} {vi ? 'giờ' : 'hours'}</option>)}
                </select>
              </div>
            )}
          </div>
        </>
      )}

      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button type="button" disabled={busy} onClick={save} style={{ ...ui.primaryBtn, padding: '11px 22px', fontSize: 14 }}>{busy ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu cài đặt' : 'Save')}</button>
          {saved && <span style={{ fontSize: 13, color: 'var(--ink-good)', fontWeight: 700 }}>✓ {vi ? 'Đã lưu' : 'Saved'}</span>}
          {err && <span style={{ fontSize: 13, color: 'var(--ink-bad)' }}>{err}</span>}
        </div>
      )}

      {canEdit && (
        <div style={{ ...ui.card }}>
          {h2(vi ? 'Phiếu mới ký gần đây' : 'Recently signed')}
          {recent.length === 0 && <div style={{ fontSize: 14, color: 'var(--c94a3b8)' }}>{vi ? 'Chưa có phiếu nào.' : 'No forms yet.'}</div>}
          {recent.map((r) => (
            <button key={r.id} type="button" onClick={() => setOpen(r.id)}
              style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'center', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)', padding: '9px 0', cursor: 'pointer', color: 'var(--ce2e8f0)' }}>
              <span style={{ width: 130, flexShrink: 0, fontSize: 13, fontWeight: 700 }}>{kindLabel(r.kind, vi)}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.customerName ?? '—'}{r.staffName ? ` · ${r.staffName}` : ''}</span>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{new Date(r.signedAt).toLocaleString(vi ? 'vi-VN' : undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
            </button>
          ))}
        </div>
      )}

      {preview && previewTpl && (
        <FormModal title={`${vi ? 'Xem mẫu' : 'Preview'} · ${previewTpl.title}`} onClose={() => setPreview(null)}>
          {previewTpl.intro && <p style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 0 }}>{previewTpl.intro}</p>}
          <FormRenderer tpl={previewTpl} answers={previewAnswers} onChange={setPreviewAnswers} palette={THEMED} vi={vi} />
        </FormModal>
      )}
      {open && <EntryViewer token={token} vi={vi} id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
