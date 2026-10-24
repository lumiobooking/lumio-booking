'use client';

// ---------------------------------------------------------------------------
// The team's notes on a salon — reminders Lumio staff leave for each other
// ("chủ tiệm hẹn gọi lại thứ 6", "đừng đăng giá cũ"). Internal: the salon
// never sees them (only /support routes read the table).
//
// On the list a salon with open notes gets a yellow sticky strip under its
// name — the newest pinned note first — so nobody walks into a shop without
// reading it. Clicking the strip (or "Ghi chú" in the panel) opens the notes.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { fresh } from '../../lib/live';
import { dropNote, firstLine, NOTE_MAX, placeNote, summaryOf, type NotesSummary, type NoteView } from '../../lib/agency-notes';
import { ago } from './agency-model';
import { C, Icon } from './AgencyParts';

export const NOTE_LOOK = {
  wash: 'var(--wash-amber-3)',
  washPinned: 'var(--wash-amber-4)',
  edge: 'rgba(245,158,11,.55)',
  bar: '#f59e0b',
  ink: 'var(--ink-warn)',
};

const short = (iso: string) => ago(iso).replace(' trước', '');

/** The yellow strip on a row. Nothing when the salon has no open note. */
export function NoteStrip({ notes, onOpen, size = 12, wrap }: { notes: NotesSummary | null | undefined; onOpen: () => void; size?: number; wrap?: boolean }) {
  const top = notes?.top;
  if (!notes || !top) return null;
  const more = notes.open - 1;
  return (
    <button type="button" className="ag-note"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => e.stopPropagation()}
      title={`${top.body}\n— ${top.by ?? 'Nhóm Lumio'} · ${ago(top.at)}${more > 0 ? `\n(+${more} ghi chú khác)` : ''}\nBấm để xem / thêm ghi chú`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
        padding: '3px 8px 3px 6px', borderRadius: 7, border: `1px solid ${NOTE_LOOK.edge}`, borderLeft: `3px solid ${NOTE_LOOK.bar}`,
        background: top.pinned ? NOTE_LOOK.washPinned : NOTE_LOOK.wash, color: C.ink2,
        fontFamily: 'inherit', fontSize: size, lineHeight: 1.35, textAlign: 'left', cursor: 'pointer',
      }}>
      <span aria-hidden style={{ flexShrink: 0 }}>{top.pinned ? '📌' : '📝'}</span>
      <span style={{
        flex: '0 1 auto', minWidth: 0, fontWeight: 600,
        ...(wrap
          ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }
          : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
      } as React.CSSProperties}>{firstLine(top.body)}</span>
      <span style={{ flexShrink: 0, color: NOTE_LOOK.ink, fontSize: size - 1, fontWeight: 600, whiteSpace: 'nowrap' }}>
        — {top.by ?? 'Lumio'} · {short(top.at)}{more > 0 ? ` · +${more}` : ''}
      </span>
    </button>
  );
}

/** The quiet "+ ghi chú" a row shows on hover when it has no note yet. */
export function AddNoteHint({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="ag-addnote" onClick={(e) => { e.stopPropagation(); onOpen(); }} onKeyDown={(e) => e.stopPropagation()}
      title="Ghi chú cho cả nhóm về tiệm này"
      style={{ border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, color: NOTE_LOOK.ink, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
      + ghi chú
    </button>
  );
}

/** The block in the salon panel: the notes at a glance and the way in. */
export function PanelNotes({ notes, onOpen }: { notes: NotesSummary | null | undefined; onOpen: () => void }) {
  if (!notes?.top) {
    return (
      <button type="button" onClick={onOpen} style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, border: `1px dashed ${NOTE_LOOK.edge}`,
        background: 'transparent', color: NOTE_LOOK.ink, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', textAlign: 'left', flexShrink: 0,
      }}>📝 <span style={{ flex: 1 }}>Thêm ghi chú cho nhóm</span></button>
    );
  }
  return (
    <button type="button" onClick={onOpen} style={{
      display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 12, border: `1px solid ${NOTE_LOOK.edge}`, borderLeft: `4px solid ${NOTE_LOOK.bar}`,
      background: notes.top.pinned ? NOTE_LOOK.washPinned : NOTE_LOOK.wash, color: C.ink2, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', flexShrink: 0,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: NOTE_LOOK.ink, letterSpacing: 0.3 }}>
        {notes.top.pinned ? '📌' : '📝'} GHI CHÚ NHÓM · {notes.open}{notes.pinned ? ` · ${notes.pinned} ghim` : ''}
        <span style={{ marginLeft: 'auto', fontWeight: 700 }}>Xem tất cả →</span>
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{notes.top.body}</span>
      <span style={{ fontSize: 12, color: C.sub }}>{notes.top.by ?? 'Nhóm Lumio'} · {ago(notes.top.at)}</span>
    </button>
  );
}

type Lists = { open: NoteView[]; done: NoteView[] };

/** All of a salon's notes: write one, pin, close, edit your own. */
export function NotesDialog({ tenantId, salon, token, phone, onClose, onSummary }: {
  tenantId: string; salon: string; token: string | null; phone: boolean;
  onClose: () => void;
  /** The row's strip, kept in step after every change. */
  onSummary: (s: NotesSummary | null) => void;
}) {
  const [lists, setLists] = useState<Lists | null>(null);
  const [draft, setDraft] = useState('');
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const base = `/support/tenants/${encodeURIComponent(tenantId)}/notes`;

  useEffect(() => {
    let live = true;
    apiFetch<Lists>(fresh(base), { token: token ?? undefined })
      .then((r) => { if (live) setLists(r); })
      .catch((e) => { if (live) { setErr(e instanceof Error ? e.message : 'Không tải được ghi chú'); setLists({ open: [], done: [] }); } });
    box.current?.focus();
    return () => { live = false; };
  }, [base, token]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);

  const apply = useCallback((next: Lists) => { setLists(next); onSummary(summaryOf(next.open)); }, [onSummary]);

  const run = async (id: string, fn: () => Promise<Lists>) => {
    setBusy(id); setErr(null);
    try { apply(await fn()); } catch (e) { setErr(e instanceof Error ? e.message : 'Không lưu được'); } finally { setBusy(null); }
  };

  const add = () => {
    const body = draft.trim();
    if (!body || !lists) return;
    void run('new', async () => {
      const n = await apiFetch<NoteView>(base, { method: 'POST', token: token ?? undefined, body: { body, pinned: pin } });
      setDraft(''); setPin(false);
      return placeNote(lists, n);
    });
  };
  const patch = (n: NoteView, body: Record<string, unknown>) => lists && void run(n.id, async () => {
    const next = await apiFetch<NoteView>(`${base}/${encodeURIComponent(n.id)}`, { method: 'PATCH', token: token ?? undefined, body });
    return placeNote(lists, next);
  });
  const remove = (n: NoteView) => lists && void run(n.id, async () => {
    await apiFetch(`${base}/${encodeURIComponent(n.id)}`, { method: 'DELETE', token: token ?? undefined });
    setConfirmDel(null);
    return dropNote(lists, n.id);
  });
  const saveEdit = (n: NoteView) => {
    if (!editing || !editing.body.trim()) return;
    patch(n, { body: editing.body });
    setEditing(null);
  };

  const shell: React.CSSProperties = phone
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, top: 'max(40px, 5dvh)', borderRadius: '20px 20px 0 0' }
    : { position: 'fixed', top: '6vh', left: '50%', transform: 'translateX(-50%)', width: 'min(560px, calc(100vw - 32px))', maxHeight: '88vh', borderRadius: 16, boxShadow: '0 30px 80px -20px rgba(0,0,0,.7)' };

  const left = NOTE_MAX - draft.length;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.5)' }} />
      <section role="dialog" aria-label={`Ghi chú nhóm · ${salon}`} onClick={(e) => e.stopPropagation()} style={{
        ...shell, zIndex: 81, background: C.panel, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden',
      }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: phone ? '14px 16px 10px' : '18px 20px 10px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.ink }}>📝 Ghi chú nhóm</div>
            <div style={{ fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{salon} · chỉ nhóm Lumio thấy, tiệm không thấy</div>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose} style={{ width: 36, height: 36, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginTop: -4 }}>
            <Icon name="x" size={20} color={C.sub} />
          </button>
        </header>

        <div style={{ padding: phone ? '0 16px 10px' : '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea ref={box} value={draft} maxLength={NOTE_MAX} rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
            placeholder="Viết lưu ý cho cả nhóm… (VD: Chủ tiệm hẹn gọi lại thứ 6 — đừng đăng bảng giá cũ)"
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 72, padding: '10px 12px', borderRadius: 10, border: `1px solid ${NOTE_LOOK.edge}`, background: NOTE_LOOK.wash, color: C.ink, fontFamily: 'inherit', fontSize: 14, lineHeight: 1.45 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.body, cursor: 'pointer' }}>
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} style={{ accentColor: '#f59e0b', width: 16, height: 16, margin: 0 }} />
              📌 Ghim (quan trọng — luôn hiện đầu)
            </label>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: left < 100 ? C.warn : C.muted }}>{left}</span>
            <button type="button" disabled={!draft.trim() || busy === 'new' || !lists} onClick={add} title="Ctrl + Enter"
              style={{ height: 36, padding: '0 16px', borderRadius: 10, border: 0, background: '#f59e0b', color: '#111827', fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', opacity: !draft.trim() || busy === 'new' ? 0.5 : 1 }}>
              {busy === 'new' ? 'Đang lưu…' : 'Lưu ghi chú'}
            </button>
          </div>
          {err && <div role="alert" style={{ fontSize: 13, color: C.bad }}>{err}</div>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: phone ? '4px 16px 24px' : '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${C.line}` }}>
          {!lists && <div style={{ color: C.sub, fontSize: 13, padding: '12px 0' }}>Đang tải…</div>}
          {lists && !lists.open.length && <div style={{ color: C.muted, fontSize: 13, padding: '12px 0' }}>Chưa có ghi chú nào đang mở.</div>}
          {lists?.open.map((n) => (
            <article key={n.id} style={{
              padding: '10px 12px', borderRadius: 12, border: `1px solid ${NOTE_LOOK.edge}`, borderLeft: `4px solid ${n.pinned ? NOTE_LOOK.bar : NOTE_LOOK.edge}`,
              background: n.pinned ? NOTE_LOOK.washPinned : NOTE_LOOK.wash, opacity: busy === n.id ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10,
            }}>
              {editing?.id === n.id ? (
                <textarea value={editing.body} maxLength={NOTE_MAX} rows={3} autoFocus
                  onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(n); } }}
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.panel, color: C.ink, fontFamily: 'inherit', fontSize: 14 }} />
              ) : (
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45 }}>
                  {n.pinned && <span aria-label="Đã ghim">📌 </span>}{n.body}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ color: C.sub }}>{n.by ?? 'Nhóm Lumio'} · {ago(n.at)}{n.editedAt ? ' · đã sửa' : ''}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 12 }}>
                  {editing?.id === n.id ? (
                    <>
                      <button type="button" style={act(C.sub)} onClick={() => setEditing(null)}>Huỷ</button>
                      <button type="button" style={act(C.link)} onClick={() => saveEdit(n)}>Lưu</button>
                    </>
                  ) : confirmDel === n.id ? (
                    <>
                      <button type="button" style={act(C.sub)} onClick={() => setConfirmDel(null)}>Không</button>
                      <button type="button" style={act(C.bad)} onClick={() => remove(n)}>Xoá thật</button>
                    </>
                  ) : (
                    <>
                      <button type="button" style={act(NOTE_LOOK.ink)} onClick={() => patch(n, { pinned: !n.pinned })}>{n.pinned ? 'Bỏ ghim' : 'Ghim'}</button>
                      {n.canEdit && <button type="button" style={act(C.link)} onClick={() => setEditing({ id: n.id, body: n.body })}>Sửa</button>}
                      {n.canEdit && <button type="button" style={act(C.bad)} onClick={() => setConfirmDel(n.id)}>Xoá</button>}
                      <button type="button" style={act(C.good)} onClick={() => patch(n, { done: true })} title="Đã xử lý — ẩn khỏi danh sách tiệm">✓ Xong</button>
                    </>
                  )}
                </span>
              </div>
            </article>
          ))}
          {lists && lists.done.length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={() => setShowDone((v) => !v)} style={{ ...act(C.sub), alignSelf: 'flex-start' }}>
                {showDone ? '▾' : '▸'} Đã xong ({lists.done.length})
              </button>
              {showDone && lists.done.map((n) => (
                <div key={n.id} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 4, opacity: busy === n.id ? 0.6 : 1 }}>
                  <span style={{ fontSize: 13, color: C.sub, whiteSpace: 'pre-wrap', wordBreak: 'break-word', textDecoration: 'line-through' }}>{n.body}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: C.muted }}>
                    {n.by ?? 'Lumio'} · xong bởi {n.doneBy ?? '—'} {n.doneAt ? `· ${ago(n.doneAt)}` : ''}
                    <button type="button" style={{ ...act(NOTE_LOOK.ink), marginLeft: 'auto' }} onClick={() => patch(n, { done: false })}>Mở lại</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function act(color: string): React.CSSProperties {
  return { border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color, cursor: 'pointer', whiteSpace: 'nowrap' };
}
