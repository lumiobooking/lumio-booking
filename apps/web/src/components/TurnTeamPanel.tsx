'use client';

/**
 * Chia turn đợt 2 + 3 (19/11/2026), under the turn rules:
 *   - each person's group (A / B), share (%) and the Pages they take;
 *   - what staff may see and do in the Inbox;
 *   - the scoreboard: turns, first-answer time, on time, passed on, ad
 *     customers left waiting — and the evening summary to the owner.
 * The rules run on the server (api messenger/turn-team.ts); every read and
 * write is the signed-in salon's own.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

type Member = { group: 'A' | 'B'; weight: number; sources: string[] };
export type Team = { members: Record<string, Member>; adGroupFirst: boolean; staffSeeAll: boolean; staffCanTake: boolean; maskPhones: boolean; adCostCents: number; nightReport: boolean };
type Source = { key: string; label: string };
type Score = { userId: string; name: string; received: number; answered: number; medianSec: number | null; onTimePct: number | null; lost: number; withCustomer: number };
type Board = { days: number; adCustomers: number; adWaiting: number; adLimitMins: number; adMoneyCents: number | null; scores: Score[]; canSeeAll: boolean };

const secText = (s: number | null) => (s == null ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

export function TurnTeamPanel({ token, vi, agents, canEdit, weighted }: { token: string | null; vi: boolean; agents: { userId: string; name: string }[]; canEdit: boolean; weighted: boolean }) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [team, setTeam] = useState<Team | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [days, setDays] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { const r = await apiFetch<{ team: Team; sources: Source[] }>('/messenger/turns/team', { token }); setTeam(r.team); setSources(r.sources); } catch (e) { setMsg(String(e)); }
  }, [token]);
  const loadBoard = useCallback(async () => {
    if (!token) return;
    try { setBoard(await apiFetch<Board>(`/messenger/turns/scoreboard?days=${days}`, { token })); } catch { setBoard(null); }
  }, [token, days]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadBoard(); }, [loadBoard]);

  const save = async (next: Team) => {
    setTeam(next);
    if (!token || !canEdit) return;
    try { const r = await apiFetch<{ team: Team; sources: Source[] }>('/messenger/turns/team', { method: 'POST', token, body: next }); setTeam(r.team); setMsg(T('Đã lưu', 'Saved')); } catch (e) { setMsg(String(e)); }
  };
  if (!team) return <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{msg ?? T('Đang tải…', 'Loading…')}</div>;
  const mem = (id: string): Member => team.members[id] ?? { group: 'A', weight: 1, sources: [] };
  const setMem = (id: string, patch: Partial<Member>) => void save({ ...team, members: { ...team.members, [id]: { ...mem(id), ...patch } } });
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ccbd5e1)', flexWrap: 'wrap' };
  const chip = (on: boolean): CSSProperties => ({ height: 26, padding: '0 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: canEdit ? 'pointer' : 'default', fontFamily: 'inherit', border: on ? '1px solid #4f46e5' : '1px solid var(--line-strong)', background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : 'var(--ccbd5e1)' });
  const totalW = agents.reduce((s, a) => s + (mem(a.userId).weight || 0), 0) || 1;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Team: group, share, Pages */}
      <div>
        <div style={ui.label}>{T('Nhóm, tỉ lệ và trang mỗi người nhận', 'Group, share and Pages per person')}</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {agents.map((a) => {
            const m = mem(a.userId);
            return (
              <div key={a.userId} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, display: 'grid', gap: 6 }}>
                <div style={row}>
                  <b style={{ minWidth: 110, color: 'var(--ce2e8f0)' }}>{a.name}</b>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    {(['A', 'B'] as const).map((g) => <button key={g} type="button" disabled={!canEdit} onClick={() => setMem(a.userId, { group: g })} style={chip(m.group === g)}>{T('Nhóm', 'Group')} {g}</button>)}
                  </span>
                  {weighted && (
                    <label style={{ ...row, gap: 4 }}>{T('Tỉ lệ', 'Share')}
                      <input type="number" min={0} max={100} disabled={!canEdit} value={m.weight}
                        onChange={(e) => setTeam({ ...team, members: { ...team.members, [a.userId]: { ...m, weight: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } } })}
                        onBlur={() => void save(team)} style={{ ...ui.input, width: 70, padding: '4px 8px' }} />
                      <span style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>≈ {Math.round(((m.weight || 0) * 100) / totalW)}%</span>
                    </label>
                  )}
                </div>
                {sources.length > 1 && (
                  <div style={{ ...row, gap: 4 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{T('Nhận khách từ:', 'Takes customers from:')}</span>
                    <button type="button" disabled={!canEdit} onClick={() => setMem(a.userId, { sources: [] })} style={chip(!m.sources.length)}>{T('Tất cả', 'All')}</button>
                    {sources.map((src) => {
                      const on = m.sources.includes(src.key);
                      return <button key={src.key} type="button" disabled={!canEdit} onClick={() => setMem(a.userId, { sources: on ? m.sources.filter((k) => k !== src.key) : [...m.sources, src.key] })} style={chip(on)}>{src.label}</button>;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {weighted && <p style={{ fontSize: 11.5, color: 'var(--c64748b)', margin: '6px 0 0' }}>{T('Khách mới đến người đang thiếu nhất so với tỉ lệ của mình trong ngày. Tỉ lệ 0 = không nhận turn tự động.', 'A new customer goes to whoever is furthest below their share today. 0 = no automatic turns.')}</p>}
      </div>

      {/* Inbox permissions and the owner's options */}
      <div>
        <div style={ui.label}>{T('Quyền của nhân viên và tuỳ chọn', 'Staff permissions and options')}</div>
        <div style={{ display: 'grid', gap: 7 }}>
          <label style={row}><input type="checkbox" disabled={!canEdit} checked={team.adGroupFirst} onChange={(e) => void save({ ...team, adGroupFirst: e.target.checked })} />{T('Khách từ quảng cáo ưu tiên Nhóm A (Nhóm A bận thì chia cho mọi người)', 'Ad customers go to Group A first (then everyone)')}</label>
          <label style={row}><input type="checkbox" disabled={!canEdit} checked={!team.staffSeeAll} onChange={(e) => void save({ ...team, staffSeeAll: !e.target.checked })} />{T('Nhân viên chỉ thấy khách của mình và khách chưa ai nhận', 'Staff see only their own and unassigned conversations')}</label>
          <label style={row}><input type="checkbox" disabled={!canEdit} checked={team.staffCanTake} onChange={(e) => void save({ ...team, staffCanTake: e.target.checked })} />{T('Nhân viên được giành khách người khác đang giữ (về mình)', 'Staff may take a conversation someone else holds')}</label>
          <label style={row}><input type="checkbox" disabled={!canEdit} checked={team.maskPhones} onChange={(e) => void save({ ...team, maskPhones: e.target.checked })} />{T('Che số điện thoại và email khách với nhân viên (•••• 0142)', 'Mask customers’ phone and email for staff (•••• 0142)')}</label>
          <label style={row}><input type="checkbox" disabled={!canEdit} checked={team.nightReport} onChange={(e) => void save({ ...team, nightReport: e.target.checked })} />{T('Gửi báo cáo chia turn cho chủ tiệm lúc 21:00', 'Send the owner a turn report at 21:00')}</label>
          <label style={row}>{T('Chi phí quảng cáo cho mỗi khách nhắn tin', 'Ad cost per messaging customer')}
            <input type="number" min={0} disabled={!canEdit} value={team.adCostCents || ''} placeholder="0"
              onChange={(e) => setTeam({ ...team, adCostCents: Math.max(0, Number(e.target.value) || 0) })} onBlur={() => void save(team)} style={{ ...ui.input, width: 120, padding: '4px 8px' }} />
            <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{T('(để ước tính tiền bị phí; 0 = không tính)', '(to estimate money lost; 0 = off)')}</span>
          </label>
        </div>
        {msg && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 6 }}>{msg}</div>}
      </div>

      {/* Scoreboard */}
      <div>
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <span style={ui.label}>{T('Bảng điểm', 'Scoreboard')}</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {[1, 7, 30].map((d) => <button key={d} type="button" onClick={() => setDays(d)} style={{ ...chip(days === d), cursor: 'pointer' }}>{d === 1 ? T('Hôm nay', 'Today') : T(`${d} ngày`, `${d} days`)}</button>)}
          </span>
        </div>
        {board && board.adWaiting > 0 && (
          <div role="status" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--wash-red)', color: 'var(--ink-bad)', fontSize: 12.5, fontWeight: 700, margin: '6px 0' }}>
            {T(`${board.adWaiting}/${board.adCustomers} khách quảng cáo phải chờ quá ${board.adLimitMins} phút`, `${board.adWaiting}/${board.adCustomers} ad customers waited over ${board.adLimitMins} min`)}
            {board.adMoneyCents != null ? T(` · ước tính ~${board.adMoneyCents.toLocaleString('vi-VN')} tiền quảng cáo bị phí`, ` · ~${board.adMoneyCents.toLocaleString()} in ad spend at risk`) : ''}
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, fontSize: 12.5 }}>
            <thead><tr style={{ color: 'var(--c94a3b8)', textAlign: 'left' }}>
              {[T('Nhân viên', 'Person'), T('Nhận', 'Turns'), T('Trả lời đầu', 'First answer'), T('Đúng hạn', 'On time'), T('Bị chuyển', 'Passed on'), T('Có SĐT/khách', 'With customer')].map((h) => <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', fontWeight: 700 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(board?.scores ?? []).map((s) => (
                <tr key={s.userId} style={{ color: 'var(--ccbd5e1)' }}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}><b style={{ color: 'var(--ce2e8f0)' }}>{s.name}</b></td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{s.received}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', color: s.medianSec != null && s.medianSec > 180 ? 'var(--ink-bad)' : 'var(--ink-good)', fontWeight: 700 }}>{secText(s.medianSec)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{s.onTimePct == null ? '—' : `${s.onTimePct}%`}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', color: s.lost ? 'var(--ink-warn)' : undefined }}>{s.lost}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{s.withCustomer}{s.received ? ` (${Math.round((s.withCustomer * 100) / s.received)}%)` : ''}</td>
                </tr>
              ))}
              {board && !board.scores.length && <tr><td colSpan={6} style={{ padding: 10, color: 'var(--c94a3b8)' }}>{T('Chưa có turn nào trong khoảng này.', 'No turns in this period yet.')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
