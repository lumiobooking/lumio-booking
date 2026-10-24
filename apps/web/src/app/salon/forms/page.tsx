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
import { FormEditor } from '../../../components/forms/FormEditor';
import { ruleText, type EditForm, type Starter } from '../../../lib/form-editor';

type Consent = 'cupping' | 'hot_stone';
interface Rule { enabled: boolean; serviceIds: string[]; categoryIds: string[] }
interface Settings {
  enabled: boolean; intakeStyle?: 'massage' | 'nail' | 'general'; intakeRequired: boolean; intakeValidMonths: number;
  consents: Record<Consent, Rule>; consentValidMonths: number; soapRequired: boolean;
  autoSend: { enabled: boolean; hoursBefore: number };
  extraQuestions: { id: string; vi: string; en: string; flag: boolean }[];
}
interface View { settings: Settings; industry: string; access: 'full' | 'tech' | 'desk'; services: { id: string; name: string; categoryId: string | null }[] }
interface Recent { id: string; kind: FormKind; title?: string | null; signedAt: string; signerRole: string; customerId: string | null; customerName: string | null; staffName: string | null }

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
  // The salon's own forms (lash, nail, waxing… or from a blank page).
  const [own, setOwn] = useState<{ forms: EditForm[]; starters: Starter[]; lang: 'vi' | 'en'; max: number } | null>(null);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<{ forms: EditForm[]; starters: Starter[]; lang: 'vi' | 'en'; max: number }>('/client-forms/custom', { token }).then(setOwn).catch(() => setOwn(null));
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

  const createOwn = async (starter: string | null) => {
    setCreating(true); setErr(null);
    try {
      const f = await apiFetch<EditForm>('/client-forms/custom', { method: 'POST', token, body: starter ? { starter } : {} });
      setOwn((o) => (o ? { ...o, forms: [...o.forms, f] } : o));
      setPicking(false);
      setEditing(f);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setCreating(false); }
  };
  const serviceNames = new Map((view?.services ?? []).map((x) => [x.id, x.name]));

  if (!s || !view) {
    return <div style={{ padding: 24, color: err ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>{err ?? (vi ? 'Đang tải…' : 'Loading…')}</div>;
  }

  const previewTpl = preview ? templates.find((t) => t.kind === preview)?.[vi ? 'vi' : 'en'] ?? null : null;

  return (
    <div style={{ padding: '20px 16px 60px', maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ce2e8f0)', margin: 0 }}>{vi ? 'Phiếu khách hàng' : 'Client forms'}</h1>
      <p style={{ fontSize: 14, color: 'var(--c94a3b8)', margin: '6px 0 16px', lineHeight: 1.5 }}>
        {vi
          ? 'Phiếu khai báo sức khoẻ & cam kết miễn trách nhiệm khách ký online trước khi làm (qua link SMS, ở quầy hoặc máy check-in). Chỉ cần chạm để chọn — lưu chữ ký, thời gian, theo từng khách và từng lần đến.'
          : 'The health form and release clients sign online before the service (by text link, at the desk or the check-in kiosk). All tap-to-answer — signature and time kept per client, per visit.'}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14, color: 'var(--ccbd5e1)', margin: '4px 0 6px' }}>
              {vi ? 'Mẫu phiếu' : 'Form'}
              <select value={s.intakeStyle ?? 'massage'} disabled={!canEdit} onChange={(e) => patch({ intakeStyle: e.target.value as Settings['intakeStyle'] })} style={{ ...ui.input, width: 'auto', minWidth: 220 }}>
                <option value="nail">{vi ? 'Làm móng (nail) — sức khoẻ & miễn trách nhiệm' : 'Nails — health & release'}</option>
                <option value="massage">{vi ? 'Massage / spa — phiếu thông tin' : 'Massage / spa intake'}</option>
                <option value="general">{vi ? 'Dịch vụ khác — sức khoẻ & miễn trách nhiệm' : 'Any service — health & release'}</option>
              </select>
            </div>
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

          {(s.intakeStyle ?? 'massage') === 'massage' && (<>
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
          </>)}

          {own && (
            <div style={{ ...ui.card, marginBottom: 14 }}>
              {h2(vi ? 'Biểu mẫu riêng của tiệm' : 'Your own forms')}
              <p style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '2px 0 10px', lineHeight: 1.5 }}>
                {vi
                  ? `Tự tạo phiếu theo nhu cầu của tiệm: cam kết nối mi, đắp bột, waxing, phiếu kỹ thuật của thợ… Viết bằng ${own.lang === 'vi' ? 'tiếng Việt' : 'tiếng Anh'} — ngôn ngữ khu vực của tiệm.`
                  : `Make the forms your business needs: lash or acrylic consent, waxing, the technician's service record… Written in ${own.lang === 'vi' ? 'Vietnamese' : 'English'} — your region's language.`}
              </p>
              {own.forms.length === 0 && <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginBottom: 10 }}>{vi ? 'Chưa có biểu mẫu riêng.' : 'No forms of your own yet.'}</div>}
              {own.forms.map((f) => (
                <button key={f.kind} type="button" disabled={!canEdit} onClick={() => setEditing(f)}
                  style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'center', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)', padding: '10px 0', cursor: canEdit ? 'pointer' : 'default', color: 'var(--ce2e8f0)' }}>
                  <span style={{ fontSize: 20 }}>{f.signer === 'staff' ? '📝' : '✍'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700, opacity: f.active ? 1 : 0.55 }}>{f.name}{f.active ? '' : (vi ? ' · tạm ngưng' : ' · paused')}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2 }}>{ruleText(f, serviceNames, vi)} · {f.fields.length} {vi ? 'câu' : 'questions'}</span>
                  </span>
                  {canEdit && <span style={{ fontSize: 13, color: 'var(--ink-link)', fontWeight: 700 }}>{vi ? 'Sửa' : 'Edit'} ›</span>}
                </button>
              ))}
              {canEdit && own.forms.length < own.max && (
                <button type="button" onClick={() => setPicking(true)}
                  style={{ marginTop: 10, background: 'transparent', border: '1px dashed var(--line-strong)', color: 'var(--ink-link)', borderRadius: 10, padding: '9px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  + {vi ? 'Tạo biểu mẫu' : 'New form'}
                </button>
              )}
            </div>
          )}

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
              <span style={{ width: 130, flexShrink: 0, fontSize: 13, fontWeight: 700 }}>{kindLabel(r.kind, vi, r.title)}</span>
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

      {picking && own && (
        <FormModal title={vi ? 'Tạo biểu mẫu' : 'New form'} onClose={() => setPicking(false)}>
          <p style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 0 }}>{vi ? 'Bắt đầu từ mẫu có sẵn rồi sửa theo ý tiệm, hoặc từ trang trống.' : 'Start from a ready-made form and adjust it, or from a blank page.'}</p>
          {own.starters.map((st) => (
            <button key={st.key} type="button" disabled={creating} onClick={() => createOwn(st.key)}
              style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'flex-start', textAlign: 'left', background: 'transparent', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', color: 'var(--ce2e8f0)' }}>
              <span style={{ fontSize: 20 }}>{st.signer === 'staff' ? '📝' : '✍'}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{st.name}{st.suggested ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-good)', fontWeight: 800 }}>{vi ? 'GỢI Ý' : 'SUGGESTED'}</span> : null}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2 }}>{st.signer === 'staff' ? (vi ? 'Thợ ghi sau buổi làm · ' : 'Technician fills after · ') : (vi ? 'Khách ký trước khi làm · ' : 'Client signs before · ')}{st.intro}</span>
              </span>
            </button>
          ))}
          <button type="button" disabled={creating} onClick={() => createOwn(null)}
            style={{ width: '100%', background: 'transparent', border: '1px dashed var(--line-strong)', color: 'var(--ink-link)', borderRadius: 12, padding: '11px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            + {vi ? 'Trang trống' : 'Blank form'}
          </button>
        </FormModal>
      )}
      {editing && (
        <FormEditor token={token} vi={vi} form={editing} services={view.services}
          onClose={() => setEditing(null)}
          onSaved={(f) => { setOwn((o) => (o ? { ...o, forms: o.forms.map((x) => (x.kind === f.kind ? f : x)) } : o)); setEditing(f); }}
          onDeleted={(kind) => { setOwn((o) => (o ? { ...o, forms: o.forms.filter((x) => x.kind !== kind) } : o)); setEditing(null); }} />
      )}
    </div>
  );
}
