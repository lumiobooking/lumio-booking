'use client';

/**
 * The owner's editor for one of the salon's own forms: its name, who fills it
 * in, which visits need it, and every question — add, reword, reorder, copy,
 * remove — with a live preview of exactly what the client (or the technician)
 * will see. Written in the salon's own language.
 *
 * The API cleans and versions the save (custom-forms.ts); a signed form keeps
 * the wording it was signed with, so editing here is always safe.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { apiFetch } from '../../lib/api';
import { ui } from '../../lib/ui';
import type { Answers, FieldType } from '../../lib/client-forms';
import {
  FIELD_TYPES, addOption, duplicateField, formProblems, moveField, newField, previewOf, typeLabel,
  type EditField, type EditForm,
} from '../../lib/form-editor';
import { FormRenderer, THEMED } from './FormRenderer';
import { FormModal } from './FormModal';

export function FormEditor({ token, vi, form, services, onClose, onSaved, onDeleted }: {
  token: string | null; vi: boolean; form: EditForm;
  services: { id: string; name: string }[];
  onClose: () => void; onSaved: (f: EditForm) => void; onDeleted: (kind: string) => void;
}) {
  const [d, setD] = useState<EditForm>(() => JSON.parse(JSON.stringify(form)) as EditForm);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sureDelete, setSureDelete] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Answers>({});
  const L = (v: string, e: string) => (vi ? v : e);
  // The form's own language decides the words of the starter; the editor's
  // buttons follow the screen.
  const formVi = d.lang === 'vi';
  const problems = useMemo(() => formProblems(d, vi), [d, vi]);
  const dirty = JSON.stringify(d) !== JSON.stringify(form);

  const setField = (i: number, patch: Partial<EditField>) => setD((x) => ({ ...x, fields: x.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const changeType = (i: number, type: FieldType) => setD((x) => {
    const old = x.fields[i];
    const fresh = newField(type, x.fields.filter((_, j) => j !== i), formVi);
    // Keep the words and, between the two list kinds, the choices.
    const keepOptions = (type === 'choice' || type === 'multi') && old.options?.length ? { options: old.options } : {};
    return { ...x, fields: x.fields.map((f, j) => (j === i ? { ...fresh, id: old.id, label: old.label, ...keepOptions } : f)) };
  });

  const save = async () => {
    if (problems.length) return;
    setBusy(true); setErr(null);
    try {
      const saved = await apiFetch<EditForm>(`/client-forms/custom/${encodeURIComponent(d.kind)}`, { method: 'PATCH', token, body: d });
      onSaved(saved);
      setD(saved);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!sureDelete) { setSureDelete(true); return; }
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/client-forms/custom/${encodeURIComponent(d.kind)}`, { method: 'DELETE', token });
      onDeleted(d.kind);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); setBusy(false); }
  };

  const chip = (on: boolean): CSSProperties => (on
    ? { background: '#6366f1', color: '#fff', border: '1px solid #6366f1', borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
    : { background: 'transparent', color: 'var(--ccbd5e1)', border: '1px solid var(--line-strong)', borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
  const small: CSSProperties = { minHeight: 32, minWidth: 32, padding: '0 8px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
  const label: CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', display: 'block', marginBottom: 4 };
  const check = (on: boolean, onChange: (v: boolean) => void, text: string) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ccbd5e1)', cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /> {text}
    </label>
  );

  return (
    <FormModal title={L('Sửa biểu mẫu', 'Edit form')} onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button type="button" onClick={() => setTab('edit')} style={chip(tab === 'edit')}>✎ {L('Soạn', 'Edit')}</button>
        <button type="button" onClick={() => { setPreviewAnswers({}); setTab('preview'); }} style={chip(tab === 'preview')}>👁 {L('Xem trước', 'Preview')}</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--c94a3b8)', alignSelf: 'center' }}>{formVi ? 'Tiếng Việt' : 'English'} · v{d.version}</span>
      </div>

      {tab === 'preview' && (
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{d.name || '…'}</div>
          {d.intro && <p style={{ fontSize: 14, color: 'var(--c94a3b8)', margin: '4px 0 12px', whiteSpace: 'pre-wrap' }}>{d.intro}</p>}
          <FormRenderer tpl={previewOf(d)} answers={previewAnswers} onChange={setPreviewAnswers} palette={THEMED} vi={formVi} />
        </div>
      )}

      {tab === 'edit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <span style={label}>{L('Tên biểu mẫu', 'Form name')}</span>
            <input value={d.name} maxLength={120} onChange={(e) => setD({ ...d, name: e.target.value })} style={{ ...ui.input, width: '100%' }} />
          </div>
          <div>
            <span style={label}>{L('Lời dẫn (không bắt buộc)', 'Intro (optional)')}</span>
            <textarea value={d.intro} maxLength={800} rows={2} onChange={(e) => setD({ ...d, intro: e.target.value })} style={{ ...ui.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          <div>
            <span style={label}>{L('Ai điền', 'Who fills it in')}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setD({ ...d, signer: 'client', validMonths: d.validMonths || 12 })} style={chip(d.signer === 'client')}>✍ {L('Khách ký trước khi làm', 'Client signs before')}</button>
              <button type="button" onClick={() => setD({ ...d, signer: 'staff', validMonths: 0 })} style={chip(d.signer === 'staff')}>📝 {L('Thợ ghi sau buổi làm', 'Technician fills after')}</button>
            </div>
          </div>

          {d.signer === 'client' && (
            <div>
              <span style={label}>{L('Ký lại sau', 'Sign again after')}</span>
              <select value={d.validMonths} onChange={(e) => setD({ ...d, validMonths: Number(e.target.value) })} style={{ ...ui.input, width: 'auto', minWidth: 180 }}>
                <option value={0}>{L('Mỗi lần đến', 'Every visit')}</option>
                {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{L(`${m} tháng`, `${m} months`)}</option>)}
              </select>
            </div>
          )}

          <div>
            <span style={label}>{L('Lượt khách nào cần', 'Which visits need it')}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <button type="button" onClick={() => setD({ ...d, appliesTo: { ...d.appliesTo, all: true } })} style={chip(d.appliesTo.all)}>{L('Mọi lượt khách', 'Every visit')}</button>
              <button type="button" onClick={() => setD({ ...d, appliesTo: { ...d.appliesTo, all: false } })} style={chip(!d.appliesTo.all)}>{L('Chỉ dịch vụ đã chọn', 'Only chosen services')}</button>
            </div>
            {!d.appliesTo.all && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 170, overflowY: 'auto' }}>
                {services.length === 0 && <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Tiệm chưa có dịch vụ nào.', 'No services yet.')}</span>}
                {services.map((sv) => {
                  const on = d.appliesTo.serviceIds.includes(sv.id);
                  return (
                    <button key={sv.id} type="button" style={{ ...chip(on), padding: '5px 10px', fontSize: 12 }}
                      onClick={() => setD({ ...d, appliesTo: { ...d.appliesTo, serviceIds: on ? d.appliesTo.serviceIds.filter((x) => x !== sv.id) : [...d.appliesTo.serviceIds, sv.id] } })}>
                      {on ? '✓ ' : ''}{sv.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {check(d.active, (v) => setD({ ...d, active: v }), L('Đang dùng (tắt = tạm ngưng, không hỏi khách)', 'In use (off = paused, nobody is asked)'))}

          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ce2e8f0)', margin: '6px 0 8px' }}>{L('Câu hỏi', 'Questions')} ({d.fields.length})</div>
            {d.fields.map((f, i) => (
              <div key={`${f.id}-${i}`} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 8, background: 'var(--raised)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--c94a3b8)', minWidth: 22 }}>{i + 1}.</span>
                  <select value={f.type} onChange={(e) => changeType(i, e.target.value as FieldType)} style={{ ...ui.input, width: 'auto', minHeight: 32, padding: '0 8px', fontSize: 13 }}>
                    {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{vi ? t.vi : t.en}</option>)}
                  </select>
                  <span style={{ flex: 1 }} />
                  <button type="button" title={L('Lên', 'Up')} disabled={i === 0} onClick={() => setD({ ...d, fields: moveField(d.fields, i, -1) })} style={small}>↑</button>
                  <button type="button" title={L('Xuống', 'Down')} disabled={i === d.fields.length - 1} onClick={() => setD({ ...d, fields: moveField(d.fields, i, 1) })} style={small}>↓</button>
                  <button type="button" title={L('Nhân đôi', 'Copy')} onClick={() => setD({ ...d, fields: duplicateField(d.fields, i) })} style={small}>⧉</button>
                  <button type="button" title={L('Xoá', 'Remove')} onClick={() => setD({ ...d, fields: d.fields.filter((_, j) => j !== i) })} style={{ ...small, color: 'var(--ink-bad)' }}>✕</button>
                </div>
                {f.type === 'note' || f.type === 'ack'
                  ? <textarea value={f.label} rows={2} maxLength={800} placeholder={typeLabel(f.type, vi)} onChange={(e) => setField(i, { label: e.target.value })} style={{ ...ui.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
                  : <input value={f.label} maxLength={f.type === 'section' ? 800 : 300} placeholder={f.type === 'section' ? L('Tên phần', 'Heading') : L('Nội dung câu hỏi', 'The question')} onChange={(e) => setField(i, { label: e.target.value })} style={{ ...ui.input, width: '100%', fontWeight: f.type === 'section' ? 800 : 400 }} />}

                {(f.type === 'choice' || f.type === 'multi') && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(f.options ?? []).map((o, k) => (
                      <div key={o.id} style={{ display: 'flex', gap: 6 }}>
                        <input value={o.label} maxLength={120} onChange={(e) => setField(i, { options: (f.options ?? []).map((x, m) => (m === k ? { ...x, label: e.target.value } : x)) })} style={{ ...ui.input, flex: 1, minHeight: 34 }} />
                        <button type="button" onClick={() => setField(i, { options: (f.options ?? []).filter((_, m) => m !== k) })} style={{ ...small, color: 'var(--ink-bad)' }}>✕</button>
                      </div>
                    ))}
                    {(f.options ?? []).length < 30 && (
                      <button type="button" onClick={() => setD((x) => ({ ...x, fields: x.fields.map((y, j) => (j === i ? addOption(y, '') : y)) }))}
                        style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px dashed var(--line-strong)', color: 'var(--ink-link)', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        + {L('Thêm lựa chọn', 'Add option')}
                      </button>
                    )}
                  </div>
                )}

                {f.type === 'scale' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 13, color: 'var(--ccbd5e1)' }}>
                    {L('Từ', 'From')} <input type="number" value={f.min ?? 0} onChange={(e) => setField(i, { min: Number(e.target.value) })} style={{ ...ui.input, width: 80, minHeight: 34 }} />
                    {L('đến', 'to')} <input type="number" value={f.max ?? 10} onChange={(e) => setField(i, { max: Number(e.target.value) })} style={{ ...ui.input, width: 80, minHeight: 34 }} />
                  </div>
                )}

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
                  {f.type !== 'section' && f.type !== 'note' && f.type !== 'ack' && check(!!f.required, (v) => setField(i, { required: v }), L('Bắt buộc', 'Required'))}
                  {f.type === 'yesno' && check(!!f.flag, (v) => setField(i, { flag: v }), L('“Có” = báo thợ trước khi làm', '“Yes” warns the technician'))}
                  {f.type === 'yesno' && check(!!f.detail, (v) => setField(i, { detail: v }), L('Hỏi thêm chi tiết khi “Có”', 'Ask for details on “Yes”'))}
                  {f.type === 'text' && check(!!f.short, (v) => setField(i, { short: v }), L('Ô ngắn', 'Short box'))}
                  {f.type === 'text' && d.signer === 'client' && (
                    <label style={{ fontSize: 13, color: 'var(--ccbd5e1)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {L('Tự điền', 'Prefill')}
                      <select value={f.prefill ?? ''} onChange={(e) => setField(i, { prefill: (e.target.value || undefined) as EditField['prefill'] })} style={{ ...ui.input, width: 'auto', minHeight: 30, padding: '0 6px', fontSize: 12 }}>
                        <option value="">{L('Không', 'None')}</option>
                        <option value="name">{L('Họ tên', 'Name')}</option>
                        <option value="phone">{L('Số điện thoại', 'Phone')}</option>
                        <option value="email">Email</option>
                        <option value="birthDate">{L('Ngày sinh', 'Birth date')}</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', margin: '10px 0 6px' }}>+ {L('Thêm câu hỏi', 'Add a question')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FIELD_TYPES.map((t) => (
                <button key={t.type} type="button" title={vi ? t.hintVi : t.hintEn} disabled={d.fields.length >= 80}
                  onClick={() => setD({ ...d, fields: [...d.fields, newField(t.type, d.fields, formVi)] })}
                  style={{ background: 'transparent', border: '1px dashed var(--line-strong)', color: 'var(--ink-link)', borderRadius: 10, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  {vi ? t.vi : t.en}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <div style={{ marginTop: 14, borderRadius: 10, background: 'var(--wash-amber)', border: '1px solid var(--line)', padding: '8px 12px' }}>
          {problems.map((p) => <div key={p} style={{ fontSize: 13, color: 'var(--ink-warn)', fontWeight: 600 }}>• {p}</div>)}
        </div>
      )}
      {err && <div role="alert" style={{ marginTop: 10, color: 'var(--ink-bad)', fontSize: 13, fontWeight: 700 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy || problems.length > 0 || !dirty} onClick={save} style={{ ...ui.primaryBtn, padding: '11px 22px', opacity: busy || problems.length > 0 || !dirty ? 0.6 : 1 }}>
          {busy ? L('Đang lưu…', 'Saving…') : L('Lưu biểu mẫu', 'Save form')}
        </button>
        {!dirty && <span style={{ fontSize: 13, color: 'var(--ink-good)', fontWeight: 700 }}>✓ {L('Đã lưu', 'Saved')}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" disabled={busy} onClick={remove} style={{ ...ui.dangerBtn }}>
          {sureDelete ? L('Bấm lần nữa để xoá', 'Tap again to delete') : L('Xoá biểu mẫu', 'Delete form')}
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 10, lineHeight: 1.5 }}>
        {L('Sửa hay xoá biểu mẫu không làm thay đổi các phiếu khách đã ký — mỗi phiếu giữ nguyên nội dung lúc ký.', 'Editing or deleting a form never changes forms already signed — each keeps the wording it was signed with.')}
      </p>
    </FormModal>
  );
}
