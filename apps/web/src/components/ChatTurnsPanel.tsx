'use client';
import { StaffInvitePanel } from './StaffInvitePanel';

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { ind } from '../lib/ui-industry';
import { TurnTeamPanel } from './TurnTeamPanel';

/**
 * Chat turns ("chia turn") — the salon admin's rules for handing each new
 * conversation to one person on the team. The rules themselves are enforced on
 * the server (api messenger/chat-assignment.ts); this screen only edits them
 * and shows who is taking turns right now.
 */

export interface TurnSettings {
  mode: 'off' | 'round-robin';
  rotation: 'strict' | 'least-busy' | 'weighted';
  botFirst: boolean;
  needStatus: boolean;
  needShift: boolean;
  needOnline: boolean;
  onlineMins: number;
  maxOpenPerAgent: number;
  preferUsualTech: boolean;
  reassignUnreadMins: number;
  reassignUnrepliedMins: number;
  maxHops: number;
  agentIds: string[];
  /** A customer from an ad is passed on after this many minutes unanswered (0 = as others). */
  reassignAdMins?: number;
  /** Tell the owner when a customer waits this long with no human reply (0 = never). */
  escalateMins?: number;
}
export interface TurnAgent {
  userId: string; name: string; role: string; inRotation: boolean;
  status: 'available' | 'away'; online: boolean; onShift: boolean | null; onDuty: boolean;
  openThreads: number; turnsToday: number;
  /** rt198: pressed "Vào ca" and the shift has not ended. */
  shiftOn?: boolean; shiftUntil?: string | null;
  /** Phones of this person that get push (owner's view; own row for staff). */
  devices?: number;
  /** rt206: why this person is not taking customers right now. */
  blockers?: string[];
}
export interface TurnsView {
  settings: TurnSettings;
  agents: TurnAgent[];
  me: TurnAgent | null;
  canEdit: boolean;
  /** The server can send push at all (VAPID set on the API). */
  pushOn?: boolean;
  /** rt206: the last customer nobody could be given, and why. */
  lastMiss?: { at: string; customer: string | null; why: string; agents: { name: string; blockers: string[] }[] } | null;
  recent: { id: string; threadId: string; userId: string | null; fromUserId: string | null; reason: string; createdAt: string; thread?: { senderName?: string | null } | null }[];
}

const REASON: Record<string, [string, string]> = {
  'round-robin': ['theo lượt', 'next in turn'],
  'usual-technician': ['thợ quen của khách', 'her usual tech'],
  'reassign-unread': ['chuyển vì chưa mở', 'passed on — not opened'],
  'reassign-unreplied': ['chuyển vì chưa trả lời', 'passed on — not answered'],
  manual: ['giao tay', 'moved by hand'],
  unassign: ['bỏ giao', 'unassigned'],
};

/** rt206: the reasons, in the owner's words, with what to do. */
const BLOCK: Record<string, [string, string]> = {
  'not-in-list': ['chưa được tích nhận turn', 'not ticked to take turns'],
  away: ['đang tắt “Sẵn sàng”', 'set to away'],
  'off-hours': ['ngoài giờ làm (bấm Vào ca để nhận)', 'outside working hours (press Vào ca)'],
  'not-present': ['chưa bấm Vào ca và không mở Lumio', 'not on shift and Lumio not open'],
  full: ['đã giữ đủ số khách tối đa', 'holding the maximum'],
  'weight-zero': ['tỉ lệ 0%', 'share 0%'],
};
const MISS: Record<string, [string, string]> = {
  'nobody-on-duty': ['không ai đang trong ca', 'nobody was on shift'],
  'everyone-full': ['ai cũng đã giữ đủ số khách tối đa', 'everyone was at the maximum'],
  'nobody-in-list': ['chưa tích ai nhận turn', 'nobody is ticked to take turns'],
  'no-match': ['không ai nhận được trang/nhóm này', 'nobody takes this Page / group'],
};

const hhmm = (iso: string) => { try { return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return ''; } };

export function ChatTurnsPanel({ token, vi }: { token: string | null; vi: boolean }) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const [view, setView] = useState<TurnsView | null>(null);
  const [draft, setDraft] = useState<TurnSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const v = await apiFetch<TurnsView>('/messenger/turns', { token });
      setView(v);
      setDraft(v.settings);
    } catch (e) { setMsg(String(e)); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (patch: Partial<TurnSettings>) => {
    if (!token || !draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    setBusy(true); setMsg(null);
    try {
      const v = await apiFetch<TurnsView>('/messenger/turns/settings', { method: 'POST', token, body: patch });
      setView(v); setDraft(v.settings);
      setMsg(T('Đã lưu', 'Saved'));
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }, [token, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view || !draft) {
    return <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{msg ?? T('Đang tải…', 'Loading…')}</div>;
  }
  const s = draft;
  const edit = view.canEdit;
  const on = s.mode === 'round-robin';
  const nameOf = (id: string | null) => view.agents.find((a) => a.userId === id)?.name ?? T('(người đã rời)', '(former staff)');

  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ccbd5e1)', cursor: edit ? 'pointer' : 'default' };
  type NumKey = 'onlineMins' | 'maxOpenPerAgent' | 'reassignUnreadMins' | 'reassignUnrepliedMins' | 'maxHops' | 'reassignAdMins' | 'escalateMins';
  // Typing changes the box; leaving it saves — not one request per keystroke.
  const num = (key: NumKey, max: number, min = 0) => (
    <input type="number" min={min} max={max} disabled={!edit} value={s[key] ?? 0}
      onChange={(e) => setDraft({ ...s, [key]: Math.min(max, Math.max(min, Number(e.target.value) || 0)) })}
      onBlur={() => { if (view && s[key] !== view.settings[key]) void save({ [key]: s[key] } as Partial<TurnSettings>); }}
      style={{ ...ui.input, width: 84, padding: '6px 8px' }} />
  );

  const inQueue = (id: string) => (s.agentIds.length ? s.agentIds.includes(id) : true);
  const toggleAgent = (id: string) => {
    const base = s.agentIds.length ? s.agentIds : view.agents.map((a) => a.userId);
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    void save({ agentIds: next });
  };
  const move = (id: string, dir: -1 | 1) => {
    const base = s.agentIds.length ? [...s.agentIds] : view.agents.map((a) => a.userId);
    const i = base.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= base.length) return;
    [base[i], base[j]] = [base[j], base[i]];
    void save({ agentIds: base });
  };
  const ordered = s.agentIds.length
    ? [...view.agents].sort((a, b) => {
        const ia = s.agentIds.indexOf(a.userId); const ib = s.agentIds.indexOf(b.userId);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      })
    : view.agents;

  const dot = (ok: boolean, label: string) => (
    <span title={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: ok ? 'var(--ink-good)' : 'var(--c64748b)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? '#22c55e' : 'var(--c475569)' }} />{label}
    </span>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={s.mode} disabled={!edit || busy} onChange={(e) => void save({ mode: e.target.value as TurnSettings['mode'] })} style={{ ...ui.input, maxWidth: 420 }}>
          <option value="off">{T('Tắt — bot trả lời, ai muốn thì tự nhận', 'Off — the bot answers, staff take over by hand')}</option>
          <option value="round-robin">{T('Bật — tự chia turn cho nhân viên', 'On — share turns out to the team')}</option>
        </select>
        {msg && <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{msg}</span>}
      </div>

      {on && (
        <div style={{ display: 'grid', gap: 14 }}>
          {/* 1. How turns are given */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12 }}>
            <div>
              <div style={ui.label}>{T('Kiểu chia', 'How turns go round')}</div>
              <select value={s.rotation} disabled={!edit || busy} onChange={(e) => void save({ rotation: e.target.value as TurnSettings['rotation'] })} style={ui.input}>
                <option value="strict">{T('Xoay vòng lần lượt A → B → C', 'Strict turns A → B → C')}</option>
                <option value="least-busy">{T('Ai ít hội thoại nhất nhận trước', 'Whoever holds the fewest')}</option>
                <option value="weighted">{T('Theo tỉ lệ % từng người', 'By each person’s share (%)')}</option>
              </select>
            </div>
            <div>
              <div style={ui.label}>{T('Bot và nhân viên', 'Bot and staff')}</div>
              <select value={s.botFirst ? '1' : '0'} disabled={!edit || busy} onChange={(e) => void save({ botFirst: e.target.value === '1' })} style={ui.input}>
                <option value="1">{T('Bot trả lời trước, nhân viên theo sau', 'Bot answers first, staff follow up')}</option>
                <option value="0">{T('Bot im, nhân viên được chia trả lời', 'Bot waits, the assigned person answers')}</option>
              </select>
            </div>
          </div>

          {/* 2. Who counts as on duty */}
          <div>
            <div style={ui.label}>{T('Chỉ chia cho người đang trực — phải đạt tất cả điều kiện được bật', 'Only to people on duty — every ticked test must pass')}</div>
            <div style={{ display: 'grid', gap: 7 }}>
              <label style={row}><input type="checkbox" disabled={!edit} checked={s.needStatus} onChange={(e) => void save({ needStatus: e.target.checked })} />
                {T('Đang bật "Sẵn sàng" (nhân viên tự bật/tắt trong Inbox)', 'Set to "Available" (each person toggles it in the Inbox)')}</label>
              <label style={row}><input type="checkbox" disabled={!edit} checked={s.needShift} onChange={(e) => void save({ needShift: e.target.checked })} />
                {T('Trong ca làm việc (giờ làm ở mục Nhân viên)', 'Inside their working hours (Staff page)')}</label>
              <label style={{ ...row, flexWrap: 'wrap' }}><input type="checkbox" disabled={!edit} checked={s.needOnline} onChange={(e) => void save({ needOnline: e.target.checked })} />
                {T('Đang mở Lumio trong', 'Has Lumio open within the last')}
                {num('onlineMins', 120, 1)}
                {T('phút gần nhất — hoặc đã bấm “Vào ca” (không cần mở app)', 'minutes — or pressed “Vào ca” (app may be closed)')}</label>
            </div>
          </div>

          {/* 3. Limits and preferences */}
          <div style={{ display: 'grid', gap: 7 }}>
            <label style={{ ...row, flexWrap: 'wrap' }}>{T('Tối đa', 'At most')}
              {num('maxOpenPerAgent', 50)}
              {T('hội thoại đang mở mỗi người (0 = không giới hạn)', 'open conversations per person (0 = no limit)')}</label>
            <label style={row}><input type="checkbox" disabled={!edit} checked={s.preferUsualTech} onChange={(e) => void save({ preferUsualTech: e.target.checked })} />
              {T('Khách cũ ưu tiên về thợ quen (thợ làm lần gần nhất), nếu người đó đang trực', 'A returning customer goes to her usual technician first, if on duty')}</label>
          </div>

          {/* 4. Passing it on */}
          <div>
            <div style={ui.label}>{T('Tự chuyển turn cho người kế tiếp (0 = không chuyển)', 'Pass the turn on to the next person (0 = never)')}</div>
            <div style={{ display: 'grid', gap: 7 }}>
              <label style={{ ...row, flexWrap: 'wrap' }}>{T('Chưa ai mở hội thoại sau', 'Nobody opened it after')}
                {num('reassignUnreadMins', 240)}{T('phút', 'min')}</label>
              <label style={{ ...row, flexWrap: 'wrap' }}>{T('Nhân viên chưa trả lời khách sau', 'The person has not replied after')}
                {num('reassignUnrepliedMins', 240)}{T('phút', 'min')}</label>
              <label style={{ ...row, flexWrap: 'wrap' }}>{T('Mỗi hội thoại chuyển tối đa', 'Pass one conversation on at most')}
                {num('maxHops', 10)}{T('lần', 'times')}</label>
              <label style={{ ...row, flexWrap: 'wrap' }}><b style={{ color: 'var(--ink-bad)' }}>{T('Khách từ quảng cáo', 'Customers from ads')}</b>{T(': chuyển nếu chưa trả lời sau', ': pass on if not answered after')}
                {num('reassignAdMins', 240)}{T('phút (0 = như khách thường)', 'min (0 = like everyone else)')}</label>
            </div>
          </div>

          {/* 4b. Nobody answered at all */}
          <div>
            <div style={ui.label}>{T('Báo khẩn cho chủ tiệm', 'Urgent alert to the owner')}</div>
            <label style={{ ...row, flexWrap: 'wrap' }}>{T('Khi khách chờ quá', 'When a customer has waited over')}
              {num('escalateMins', 240)}{T('phút mà chưa ai trả lời (0 = tắt). Báo cho chủ tiệm và cả nhóm đang trong ca — ai rảnh bấm vào là nhận được khách.', 'min with no reply (0 = off). Sent to the owner and everyone on shift — whoever is free taps it to take the customer.')}</label>
          </div>

          {/* 5. The team, in turn order */}
          <div>
            <div style={ui.label}>{T('Nhân viên nhận turn (theo thứ tự lượt)', 'Who takes turns (in turn order)')}</div>
            <p style={{ fontSize: 12, color: 'var(--c94a3b8)', margin: '0 0 6px', lineHeight: 1.5 }}>{T('Nhân viên bấm “Vào ca” trong Hộp thư là bắt đầu nhận khách; điện thoại reo cả khi tắt app. Hết giờ làm Lumio tự cho ra ca.', 'Staff press “Vào ca” in the Inbox to start taking customers; the phone rings even with the app closed. Lumio ends the shift after their hours.')}</p>
            {view.lastMiss && (
              <div style={{ margin: '0 0 8px', padding: '9px 11px', borderRadius: 10, background: 'var(--wash-red)', color: 'var(--ink-bad)', fontSize: 12.5, lineHeight: 1.5 }}>
                <b>{T('Khách gần nhất không được chia', 'Last customer not given to anyone')}</b>{view.lastMiss.customer ? ` (${view.lastMiss.customer}, ${hhmm(view.lastMiss.at)})` : ` (${hhmm(view.lastMiss.at)})`}: {vi ? MISS[view.lastMiss.why]?.[0] : MISS[view.lastMiss.why]?.[1]}.
                {' '}{T('Khi có người vào ca, khách đang chờ (trong 24 giờ) sẽ tự được chia.', 'When someone starts a shift, waiting customers (last 24 h) are given out automatically.')}
              </div>
            )}
            {view.pushOn === false && (
              <div style={{ margin: '0 0 8px', padding: '8px 10px', borderRadius: 10, background: 'var(--wash-amber-3)', color: 'var(--ink-warn)', fontSize: 12.5, fontWeight: 600, lineHeight: 1.45 }}>
                {T('Máy chủ chưa bật thông báo đẩy (thiếu VAPID trên Render) — điện thoại nhân viên sẽ chưa reo.', 'Push is not configured on the server (VAPID missing on Render) — staff phones will not ring yet.')}
              </div>
            )}
            <div style={{ display: 'grid', gap: 6 }}>
              {ordered.map((a, i) => (
                <div key={a.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, background: inQueue(a.userId) ? 'var(--c0f172a)' : 'transparent', opacity: inQueue(a.userId) ? 1 : 0.6 }}>
                  <input type="checkbox" disabled={!edit || busy} checked={inQueue(a.userId)} onChange={() => toggleAgent(a.userId)} aria-label={a.name} />
                  <b style={{ fontSize: 13, color: 'var(--ce2e8f0)', minWidth: 110 }}>{i + 1}. {a.name}</b>
                  <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
                    {dot(a.onDuty, a.onDuty ? T('đang nhận khách', 'taking customers') : T('không nhận khách', 'not taking customers'))}
                    {a.shiftOn
                      ? dot(true, a.shiftUntil ? T(`đã vào ca · tới ${hhmm(a.shiftUntil)}`, `on shift · until ${hhmm(a.shiftUntil)}`) : T('đã vào ca', 'on shift'))
                      : dot(false, T('chưa vào ca', 'not on shift'))}
                    {!a.onDuty && (a.blockers ?? []).length > 0 && (
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-warn)' }}>↳ {(a.blockers ?? []).map((b) => (vi ? BLOCK[b]?.[0] : BLOCK[b]?.[1]) ?? b).join(' · ')}</span>
                    )}
                    {a.devices !== undefined && (a.devices > 0
                      ? dot(true, T(`📱 ${a.devices} máy nhận thông báo`, `📱 ${a.devices} phone(s) get alerts`))
                      : <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-bad)' }}>📵 {T('chưa bật thông báo — nhắc bạn ấy', 'no alerts on — remind them')}</span>)}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c94a3b8)' }}>
                    {T(`${a.openThreads} đang giữ · ${a.turnsToday} turn/24h`, `${a.openThreads} open · ${a.turnsToday} turns/24h`)}
                  </span>
                  {edit && s.agentIds.length > 0 && inQueue(a.userId) && (
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <button type="button" onClick={() => move(a.userId, -1)} disabled={busy} style={miniBtn} aria-label={T('Lên', 'Up')}>↑</button>
                      <button type="button" onClick={() => move(a.userId, 1)} disabled={busy} style={miniBtn} aria-label={T('Xuống', 'Down')}>↓</button>
                    </span>
                  )}
                </div>
              ))}
              {!view.agents.length && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{T('Chưa có nhân viên nào có tài khoản đăng nhập.', 'No team member has a login yet.')}</div>}
            </div>
            {/* rt200: add people to the team right here — link + Facebook, no accounts to create. */}
            {view.canEdit && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--ink-link)' }}>＋ {T('Thêm nhân viên nhận tin (gửi link mời)', 'Add people (send an invite link)')}</summary>
                <div style={{ marginTop: 8 }}><StaffInvitePanel token={token} vi={vi} /></div>
              </details>
            )}
            {edit && !s.agentIds.length && view.agents.length > 1 && (
              <p style={{ fontSize: 11.5, color: 'var(--c64748b)', margin: '6px 0 0' }}>{T('Đang chia cho tất cả mọi người. Bỏ tick một người để chọn danh sách riêng và sắp thứ tự lượt.', 'Everyone takes turns. Untick someone to pick your own list and set the order.')}</p>
            )}
          </div>

          {/* 5b. Team, permissions, scoreboard (đợt 2 + 3) */}
          <TurnTeamPanel token={token} vi={vi} agents={view.agents.map((a) => ({ userId: a.userId, name: a.name }))} canEdit={edit} weighted={s.rotation === 'weighted'} />

          {/* 6. The last turns */}
          {view.recent.length > 0 && (
            <div>
              <div style={ui.label}>{T('Turn gần đây', 'Recent turns')}</div>
              <div style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--c94a3b8)' }}>
                {view.recent.slice(0, 8).map((r) => (
                  <div key={r.id}>
                    {new Date(r.createdAt).toLocaleString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    {' · '}<b style={{ color: 'var(--ccbd5e1)' }}>{r.thread?.senderName || T('Khách', 'Customer')}</b>
                    {' → '}{r.userId ? nameOf(r.userId) : T('không ai', 'nobody')}
                    {' · '}{(REASON[r.reason] ?? [r.reason, r.reason])[vi ? 0 : 1]}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '12px 0 0', lineHeight: 1.5 }}>
        {T('Mỗi tin nhắn đầu tiên của một hội thoại mới sẽ được giao cho người kế tiếp đang trực. Không ai trực thì bot vẫn trả lời, khách không phải chờ. Nhân viên nhận thông báo trên điện thoại khi có turn, và có thể chuyển hội thoại cho người khác ngay trong Inbox.',
           'The first message of each new conversation goes to the next person on duty. If nobody is on duty the bot still answers, so the customer never waits. The person gets a phone notification, and can pass the conversation on from the Inbox.')}
      </p>
    </div>
  );
}

const miniBtn: CSSProperties = { width: 26, height: 26, minHeight: 26, borderRadius: 6, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 12, padding: 0 };
