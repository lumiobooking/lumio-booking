'use client';

/**
 * Thư viện ảnh gửi khách (19/11/2026) — Trợ lý AI › Kiến thức › Ảnh gửi khách.
 *
 * The pictures this salon lets its chat send, each with the labels the AI
 * chooses by (kind, service, style words), whether the AI may send it, an end
 * date, and privacy flags found when the picture was read. The second page is
 * the rules: per kind, AI sends / staff approves / off.
 *
 * Every call is the signed-in salon's own (the server takes the tenant from
 * the session); changing anything is the owner's (canEdit).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { apiFetch } from '../../lib/api';
import { shrinkPhoto } from '../../lib/shrink-photo';
import {
  PHOTO_KINDS, blockedLabel, blockedTone, dateInput, filterItems, flagText, kindHint, kindLabel, modeLabel, modesFor, parseTags,
  type LibFilter, type LibraryItem, type LibraryResponse, type PhotoKind, type PhotoRules,
} from '../../lib/photo-library';
import { Empty, L, Search, SubTabs, Switch, ghostBtn, primaryBtn } from '../ai/aiKit';

const card: CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--line)', borderRadius: 14, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };
const chip: CSSProperties = { fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--wash-blue)', color: 'var(--ink-link)', border: '1px solid var(--line)' };
const field: CSSProperties = { width: '100%', boxSizing: 'border-box', minHeight: 40, padding: '0 10px', borderRadius: 9, border: '1px solid var(--line-strong)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 14, fontFamily: 'inherit' };
const tone = (t: 'bad' | 'warn' | null): CSSProperties => (t === 'bad'
  ? { background: 'var(--wash-red)', color: 'var(--ink-bad)', border: '1px solid var(--line)' }
  : { background: 'var(--wash-amber-3)', color: 'var(--ink-warn)', border: '1px solid var(--line)' });

export function PhotoLibrary({ token, vi, canEdit }: { token: string | null; vi: boolean; canEdit: boolean }) {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<'library' | 'rules'>('library');
  const [filter, setFilter] = useState<LibFilter>('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<LibraryItem | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await apiFetch<LibraryResponse>('/messenger/photo-library', { token })); setErr(null); }
    catch (e) { setErr(String(e)); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => (data ? filterItems(data.items, filter, q) : []), [data, filter, q]);
  const count = (k: LibFilter) => (data ? filterItems(data.items, k, '').length : 0);
  const review = count('review');

  async function upload(files: FileList | null) {
    if (!files?.length || !token) return;
    setBusy(true); setErr(null);
    const kind: PhotoKind = filter !== 'all' && filter !== 'review' ? filter : 'sample';
    try {
      for (const f of Array.from(files).slice(0, 12)) {
        if (!/^image\/(jpeg|png|webp)$/.test(f.type)) continue;
        const dataUrl = await shrinkPhoto(f);
        await apiFetch('/messenger/photo-library', { method: 'POST', token, body: { dataUrl, kind } });
      }
      await load();
    } catch (e) {
      const m = String(e);
      setErr(/STORAGE_NOT_CONFIGURED/.test(m) ? L(vi, 'Chưa thêm được ảnh: hệ thống chưa cài nơi lưu ảnh. Báo Lumio hỗ trợ.', 'Not added: file storage is not set up. Contact Lumio support.') : m);
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    if (!token) return;
    setBusy(true); setErr(null);
    try {
      const v = await apiFetch<LibraryItem>(`/messenger/photo-library/${id}`, { method: 'POST', token, body });
      setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === id ? v : i)) } : d));
      if (edit?.id === id) setEdit(v);
      void load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!token) return;
    setBusy(true);
    try { await apiFetch(`/messenger/photo-library/${id}/delete`, { method: 'POST', token }); setEdit(null); await load(); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function reimport() {
    if (!token) return;
    setBusy(true);
    try { await apiFetch('/messenger/photo-library/import', { method: 'POST', token }); await load(); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function saveRules(rules: PhotoRules) {
    if (!token) return;
    setData((d) => (d ? { ...d, rules } : d));
    try { const r = await apiFetch<PhotoRules>('/messenger/photo-library/rules', { method: 'POST', token, body: rules }); setData((d) => (d ? { ...d, rules: r } : d)); }
    catch (e) { setErr(String(e)); void load(); }
  }

  if (!data) return <Empty>{err ?? L(vi, 'Đang tải thư viện ảnh…', 'Loading the photo library…')}</Empty>;
  const w = data.warnings;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c94a3b8)', lineHeight: 1.55 }}>
        {L(vi, 'AI chỉ gửi ảnh trong thư viện này, chọn theo loại, dịch vụ và nhãn (kiểu, màu, độ dài) — không theo chữ trong bài đăng. Ảnh có mặt người, số điện thoại hay tên tiệm khác bị khoá tới khi anh/chị xác nhận.',
          'The AI only sends pictures from this library, chosen by kind, service and labels (style, colour, length) — never by the words in a post. Pictures with a face, a phone number or another shop’s name stay locked until you confirm.')}
      </p>
      <SubTabs label={L(vi, 'Thư viện ảnh', 'Photo library')} value={page} onChange={setPage}
        tabs={[{ id: 'library', label: L(vi, 'Thư viện', 'Library'), count: data.items.length }, { id: 'rules', label: L(vi, 'Cài đặt gửi ảnh', 'Sending rules') }]} />

      {err && <div role="alert" style={{ ...tone('bad'), padding: '10px 12px', borderRadius: 10, fontSize: 13.5 }}>{err}</div>}

      {page === 'rules' ? <Rules rules={data.rules} vi={vi} canEdit={canEdit} onChange={saveRules} /> : (
        <>
          {(w.priceStale + w.flagged + w.pending + w.expired) > 0 && (
            <div style={{ ...tone('warn'), padding: '10px 12px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.5 }}>
              <b>{L(vi, 'Cần anh/chị xem: ', 'Needs you: ')}</b>
              {[
                w.priceStale ? L(vi, `${w.priceStale} ảnh bảng giá cũ hơn giá trong hệ thống — AI đang gửi giá bằng chữ`, `${w.priceStale} price list older than today’s prices — the AI gives prices in words`) : '',
                w.flagged ? L(vi, `${w.flagged} ảnh có mặt người / thông tin riêng đang bị khoá`, `${w.flagged} picture(s) with a face or private details locked`) : '',
                w.pending ? L(vi, `${w.pending} ảnh lấy từ bài đăng chờ duyệt`, `${w.pending} picture(s) from posts waiting for review`) : '',
                w.expired ? L(vi, `${w.expired} ảnh đã hết hạn`, `${w.expired} expired`) : '',
              ].filter(Boolean).join(' · ')}
              {' '}<button type="button" onClick={() => setFilter('review')} style={{ ...ghostBtn, minHeight: 30, marginLeft: 4 }}>{L(vi, 'Xem', 'Show')}</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Search id="photo-find" value={q} onChange={setQ} label={L(vi, 'Tìm ảnh', 'Find a photo')} placeholder={L(vi, 'Tìm: french, nude, mắt mèo…', 'Find: french, nude, cat-eye…')} />
            {canEdit && (
              <>
                <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={(e) => void upload(e.target.files)} />
                <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                  {busy ? L(vi, 'Đang xử lý…', 'Working…') : L(vi, '＋ Thêm ảnh', '＋ Add photos')}
                </button>
                <button type="button" disabled={busy} onClick={() => void reimport()} style={ghostBtn} title={L(vi, 'Lấy ảnh dịch vụ, bảng giá, mặt tiền và bài đã đăng chưa có trong thư viện', 'Bring in service photos, price list, storefront and posts not yet here')}>
                  {L(vi, 'Lấy ảnh có sẵn', 'Bring in existing')}
                </button>
              </>
            )}
          </div>

          <div role="tablist" aria-label={L(vi, 'Lọc theo loại', 'Filter by kind')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['all', 'review', ...PHOTO_KINDS.filter((k) => k !== 'result')] as LibFilter[]).map((f) => {
              const on = filter === f;
              const n = count(f);
              return (
                <button key={f} type="button" role="tab" aria-selected={on} onClick={() => setFilter(f)}
                  style={{ minHeight: 34, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 800 : 600,
                    border: on ? '1px solid #4f46e5' : '1px solid var(--line-strong)', background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : f === 'review' && n ? 'var(--ink-warn)' : 'var(--ce2e8f0)' }}>
                  {f === 'all' ? L(vi, 'Tất cả', 'All') : f === 'review' ? L(vi, 'Cần xem', 'Needs you') : kindLabel(f, vi)} {n}
                </button>
              );
            })}
          </div>
          {filter !== 'all' && filter !== 'review' && canEdit && (
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, `Ảnh thêm lúc này được xếp vào “${kindLabel(filter, true)}”.`, `Photos added now go under “${kindLabel(filter, false)}”.`)}</div>
          )}

          {items.length === 0 ? (
            <Empty>{data.items.length === 0
              ? L(vi, 'Chưa có ảnh nào. Bấm “＋ Thêm ảnh” để đưa mẫu, bảng giá, ảnh mặt tiền vào — AI sẽ tự gắn nhãn, anh/chị sửa lại nếu cần.', 'No photos yet. “＋ Add photos” to add samples, the price list and the storefront — the AI labels them, you can correct.')
              : review === 0 && filter === 'review' ? L(vi, 'Không có ảnh nào cần xem. 👍', 'Nothing needs you. 👍') : L(vi, 'Không có ảnh khớp.', 'No matching photos.')}</Empty>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {items.map((i) => <Card key={i.id} i={i} vi={vi} canEdit={canEdit} busy={busy} onPatch={patch} onEdit={() => setEdit(i)} />)}
            </div>
          )}
        </>
      )}

      {edit && <Editor item={edit} services={data.services} vi={vi} canEdit={canEdit} busy={busy} onClose={() => setEdit(null)} onPatch={patch} onRemove={remove} />}
    </div>
  );
}

function Card({ i, vi, canEdit, busy, onPatch, onEdit }: { i: LibraryItem; vi: boolean; canEdit: boolean; busy: boolean; onPatch: (id: string, b: Record<string, unknown>) => void; onEdit: () => void }) {
  const why = blockedLabel(i.blocked === 'ai_off' ? null : i.blocked, vi);
  const t = blockedTone(i.blocked);
  return (
    <div style={card}>
      <button type="button" onClick={onEdit} aria-label={L(vi, `Sửa ảnh ${i.title || ''}`, `Edit photo ${i.title || ''}`)} style={{ padding: 0, border: 0, background: 'transparent', cursor: 'pointer', borderRadius: 10, overflow: 'hidden', aspectRatio: '4 / 3', display: 'block' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={i.url} alt={i.title || kindLabel(i.kind, vi)} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: 'var(--c1e293b)' }} />
      </button>
      <b style={{ fontSize: 14, color: 'var(--ce2e8f0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title || L(vi, '(chưa đặt tên)', '(untitled)')}</b>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <span style={chip}>{kindLabel(i.kind, vi)}</span>
        {i.serviceName && <span style={chip}>{i.serviceName}</span>}
        {i.tags.slice(0, 4).map((tg) => <span key={tg} style={chip}>{tg}</span>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--c94a3b8)' }}>
        {L(vi, 'AI được gửi', 'AI may send')}
        <Switch on={i.aiAllowed} disabled={!canEdit || busy} onChange={() => onPatch(i.id, { aiAllowed: !i.aiAllowed })} label={L(vi, 'AI được gửi ảnh này', 'The AI may send this photo')} />
      </div>
      {why && <span style={{ ...tone(t), fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{why}{i.flags.length ? ` (${flagText(i.flags, vi)})` : ''}</span>}
      {canEdit && i.status === 'pending' && <button type="button" disabled={busy} onClick={() => onPatch(i.id, { status: 'ready' })} style={{ ...ghostBtn, minHeight: 34 }}>{L(vi, 'Duyệt cho dùng', 'Approve')}</button>}
      {canEdit && (i.blocked === 'flagged' || i.blocked === 'no_consent') && <button type="button" disabled={busy} onClick={() => onPatch(i.id, { consent: true })} style={{ ...ghostBtn, minHeight: 34 }}>{L(vi, 'Khách đã đồng ý', 'Customer agreed')}</button>}
      {canEdit && i.blocked === 'price_stale' && <button type="button" disabled={busy} onClick={() => onPatch(i.id, { priceChecked: true })} style={{ ...ghostBtn, minHeight: 34 }}>{L(vi, 'Giá trên ảnh đã đúng', 'Prices on it are right')}</button>}
      <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>
        {i.sentCount ? L(vi, `Đã gửi ${i.sentCount} lần`, `Sent ${i.sentCount}×`) : L(vi, 'Chưa gửi lần nào', 'Not sent yet')}
        {i.expiresAt ? ` · ${L(vi, 'hết hạn', 'ends')} ${new Date(i.expiresAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US')}` : ''}
      </span>
    </div>
  );
}

function Editor({ item, services, vi, canEdit, busy, onClose, onPatch, onRemove }: {
  item: LibraryItem; services: { id: string; name: string }[]; vi: boolean; canEdit: boolean; busy: boolean;
  onClose: () => void; onPatch: (id: string, b: Record<string, unknown>) => void; onRemove: (id: string) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [kind, setKind] = useState<PhotoKind>(item.kind);
  const [serviceId, setServiceId] = useState(item.serviceId ?? '');
  const [tags, setTags] = useState(item.tags.join(', '));
  const [expires, setExpires] = useState(dateInput(item.expiresAt));
  const [sure, setSure] = useState(false);
  useEffect(() => {
    setTitle(item.title); setKind(item.kind); setServiceId(item.serviceId ?? ''); setTags(item.tags.join(', ')); setExpires(dateInput(item.expiresAt)); setSure(false);
  }, [item]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const save = () => onPatch(item.id, { title, kind, serviceId: serviceId || null, tags: parseTags(tags), expiresAt: expires ? `${expires}T23:59:00` : null });
  const lab: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)' };
  return (
    <div role="dialog" aria-modal="true" aria-label={L(vi, 'Sửa ảnh', 'Edit photo')} onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, background: 'var(--c0f172a)', width: 'min(560px, 100%)', maxHeight: '92vh', overflowY: 'auto', padding: 16, gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt="" style={{ width: 160, maxWidth: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 10, background: 'var(--c1e293b)' }} />
          <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--c94a3b8)' }}>
            <b style={{ color: 'var(--ce2e8f0)', fontSize: 15 }}>{L(vi, 'Ảnh trong thư viện', 'Library photo')}</b>
            <span>{L(vi, 'Nguồn', 'From')}: {item.source === 'service' ? L(vi, 'ảnh dịch vụ', 'service photo') : item.source === 'branding' ? L(vi, 'thương hiệu', 'branding') : item.source === 'post' ? L(vi, 'bài đã đăng', 'a post') : item.source === 'chat' ? L(vi, 'khách gửi trong chat', 'sent by a customer in chat') : L(vi, 'tải lên', 'upload')}</span>
            {item.flags.length > 0 && <span style={{ ...tone('bad'), padding: '4px 8px', borderRadius: 8, fontWeight: 700 }}>{L(vi, `Có ${flagText(item.flags, true)}`, `Shows ${flagText(item.flags, false)}`)}</span>}
            <span>{kindHint(kind, vi)}</span>
          </div>
        </div>
        <label style={lab}>{L(vi, 'Tên ảnh', 'Name')}<input value={title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} maxLength={60} style={field} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label style={lab}>{L(vi, 'Loại', 'Kind')}
            <select value={kind} disabled={!canEdit} onChange={(e) => setKind(e.target.value as PhotoKind)} style={field}>
              {PHOTO_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k, vi)}</option>)}
            </select>
          </label>
          <label style={lab}>{L(vi, 'Dịch vụ', 'Service')}
            <select value={serviceId} disabled={!canEdit} onChange={(e) => setServiceId(e.target.value)} style={field}>
              <option value="">{L(vi, '— Không gắn —', '— None —')}</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <label style={lab}>{L(vi, 'Nhãn (cách nhau dấu phẩy): kiểu, màu, độ dài, dáng…', 'Labels (comma separated): style, colour, length, shape…')}
          <input value={tags} disabled={!canEdit} onChange={(e) => setTags(e.target.value)} placeholder="french, trắng, vuông, dài" style={field} />
        </label>
        <label style={lab}>{L(vi, 'Hết hạn (khuyến mãi, bảng giá theo mùa)', 'Ends (promotions, seasonal price lists)')}
          <input type="date" value={expires} disabled={!canEdit} onChange={(e) => setExpires(e.target.value)} style={field} />
        </label>
        {canEdit && (
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, color: 'var(--ce2e8f0)' }}>
            <input type="checkbox" checked={item.consent} disabled={busy} onChange={() => onPatch(item.id, { consent: !item.consent })} style={{ width: 18, height: 18 }} />
            {L(vi, 'Khách trong ảnh đã đồng ý cho tiệm dùng ảnh', 'The customer in the photo agreed to its use')}
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {canEdit ? (
            sure
              ? <button type="button" disabled={busy} onClick={() => onRemove(item.id)} style={{ ...primaryBtn, background: '#b91c1c' }}>{L(vi, 'Xoá hẳn ảnh này', 'Delete this photo')}</button>
              : <button type="button" onClick={() => setSure(true)} style={{ ...ghostBtn, color: 'var(--ink-bad)' }}>{L(vi, 'Xoá', 'Delete')}</button>
          ) : <span />}
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={ghostBtn}>{L(vi, 'Đóng', 'Close')}</button>
            {canEdit && <button type="button" disabled={busy} onClick={() => { save(); onClose(); }} style={primaryBtn}>{L(vi, 'Lưu', 'Save')}</button>}
          </span>
        </div>
      </div>
    </div>
  );
}

function Rules({ rules, vi, canEdit, onChange }: { rules: PhotoRules; vi: boolean; canEdit: boolean; onChange: (r: PhotoRules) => void }) {
  const seg = <T extends string | number>(value: T, opts: { v: T; label: string; disabled?: boolean }[], set: (v: T) => void, label: string) => (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 10, border: '1px solid var(--line-strong)', flexWrap: 'wrap' }}>
      {opts.map((o) => {
        const on = o.v === value;
        return (
          <button key={String(o.v)} type="button" role="radio" aria-checked={on} disabled={!canEdit || o.disabled} onClick={() => set(o.v)}
            style={{ minHeight: 32, padding: '0 10px', borderRadius: 8, border: 0, cursor: canEdit ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
              background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : 'var(--ce2e8f0)', opacity: o.disabled ? 0.4 : 1 }}>{o.label}</button>
        );
      })}
    </div>
  );
  const row = (title: string, hint: string, control: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
        <b style={{ fontSize: 14, color: 'var(--ce2e8f0)' }}>{title}</b>
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{hint}</div>
      </div>
      {control}
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
      <div style={{ ...card, padding: '6px 16px 10px' }}>
        <h3 style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--ce2e8f0)' }}>{L(vi, 'Mỗi loại ảnh', 'Per kind of picture')}</h3>
        {PHOTO_KINDS.map((k) => row(kindLabel(k, vi), kindHint(k, vi),
          seg(rules.modes[k], (['auto', 'approve', 'off'] as const).map((m) => ({ v: m, label: modeLabel(m, vi), disabled: !modesFor(k).includes(m) })),
            (m) => onChange({ ...rules, modes: { ...rules.modes, [k]: m } }), kindLabel(k, vi))))}
        <p style={{ fontSize: 12.5, color: 'var(--c94a3b8)', margin: '10px 0 0', lineHeight: 1.5 }}>
          {L(vi, '“Nhân viên duyệt”: AI báo khách là tiệm sẽ gửi ảnh ngay, và ảnh hiện trong Hộp thư để nhân viên bấm gửi.', '“Staff approves”: the AI tells the customer the salon will send the pictures, and they wait in the Inbox for one tap.')}
        </p>
      </div>
      <div style={{ ...card, padding: '6px 16px 10px' }}>
        <h3 style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--ce2e8f0)' }}>{L(vi, 'Độ chắc chắn', 'How sure')}</h3>
        {row(L(vi, 'Gửi khi khớp từ', 'Send when the match is at least'), L(vi, 'Thấp hơn: gửi 1 ảnh gần nhất và hỏi lại khách', 'Below this: one closest picture and a question'),
          seg(rules.minScore, [0.7, 0.8, 0.9].map((v) => ({ v: v as 0.7 | 0.8 | 0.9, label: `${Math.round(v * 100)}%` })), (v) => onChange({ ...rules, minScore: v }), L(vi, 'Mức khớp', 'Match')))}
        {row(L(vi, 'Tối đa mỗi lần', 'At most per message'), L(vi, 'Nhiều ảnh quá làm rối cuộc chat', 'Too many pictures clutter the chat'),
          seg(rules.max, [1, 2, 3].map((v) => ({ v: v as 1 | 2 | 3, label: String(v) })), (v) => onChange({ ...rules, max: v }), L(vi, 'Số ảnh', 'Pictures')))}
        {row(L(vi, 'Không có ảnh mẫu khớp', 'No matching sample'), L(vi, 'AI trả lời bằng chữ và…', 'The AI answers in words and…'),
          seg(rules.whenNone, [{ v: 'notify' as const, label: L(vi, 'Báo nhân viên', 'Tell the team') }, { v: 'quiet' as const, label: L(vi, 'Im lặng', 'Nothing more') }], (v) => onChange({ ...rules, whenNone: v }), L(vi, 'Khi không có ảnh', 'When none')))}
        <p style={{ fontSize: 12.5, color: 'var(--c94a3b8)', margin: '10px 0 0', lineHeight: 1.5 }}>
          {L(vi, 'Luôn luôn: không gửi lại ảnh đã gửi trong cùng cuộc chat, không gửi khuyến mãi hết hạn, không gửi bảng giá cũ hơn giá trong hệ thống, không gửi ảnh có mặt khách khi chưa có đồng ý.',
            'Always: no picture twice in one chat, no expired promotions, no price list older than today’s prices, no customer’s face without consent.')}
        </p>
      </div>
    </div>
  );
}
