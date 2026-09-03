'use client';

/**
 * The Trends tab: what is moving in this salon's trade, pulled every morning.
 *
 * THREE LAYERS, TOP TO BOTTOM
 *
 *   1. What the feeds say — cards with a picture, a count and how fast it is
 *      moving, ranked across YouTube and Instagram; then the searches rising
 *      in the salon's state. Refreshed daily on the server, shared by every
 *      salon in the same trade and market.
 *   2. What Lumio picked — the team's own notes, the layer a person wrote.
 *   3. Where to look yourself — the tool links that used to be the whole tab,
 *      now a compact grid, with the salon's own search topics shown ONCE.
 *
 * WHY THE OLD TAB WAS REPLACED
 *
 * It was ten links and a list of search terms, repeated under every link. For
 * a nail salon a trend is a picture of a set, and the tab was asking the owner
 * to go and find one. The words "live data" at the top described the pages on
 * the other side of the links, not this one.
 *
 * Everything here reads the localized half of the API envelope: the server
 * renders the payload in both languages, and `pick` chooses.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fmtInTz } from '../lib/datetime';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

export interface TrendCard {
  id: string; source: 'youtube' | 'instagram' | 'google'; title: string; url: string;
  thumbUrl: string | null; count: number | null; growthPct: number | null; breakout: boolean;
  publishedAt: string | null; durationSec: number | null; via: string | null;
  matchesService: string | null; matchesEvent: string | null;
  countLabel: string | null; perDayLabel: string | null; growthLabel: string | null; ageLabel: string | null;
}
export interface RisingQuery { query: string; growthPct: number | null; breakout: boolean; matchesService: string | null }
interface Pick { id: string; title: string; body: string; at: string }
interface SourceState { configured: boolean; fetchedAt: string | null; stale: boolean; error: string | null; connected?: boolean }
interface MinedPhrase extends RisingQuery { posts: number }
interface FeedLink { key: string; title: string; url: string; what: string; how: string; source: string; topics?: { label: string; why: string; from: string }[] }
export interface TrendFeed {
  scope: string; fetchedAt: string | null; stale: boolean; regionLabel: string;
  items: TrendCard[]; rising: RisingQuery[]; pinterestRising?: RisingQuery[]; mined?: MinedPhrase[]; picks: Pick[];
  sources: { youtube: SourceState; google: SourceState; instagram: SourceState; pinterest?: SourceState };
  links: { weekly: FeedLink[]; monthly: FeedLink[]; regionKnown: boolean };
}
type Envelope = TrendFeed & { en?: TrendFeed };

interface Props {
  token: string | null;
  vi: boolean;
  isMobile: boolean;
  /** Extra link rows the plan already carries (hashtag pages, product rankings). */
  extraLinks: FeedLink[];
  /** Open the composer with a caption started from this card. */
  onMakePost: (card: TrendCard) => void;
  /** The Lumio support session may pull again; a salon account may not. */
  canRefresh: boolean;
}

const SOURCE_LABEL: Record<TrendCard['source'], string> = { youtube: 'YouTube', instagram: 'Instagram', google: 'Google' };
const SOURCE_CHIP: Record<TrendCard['source'], { bg: string; fg: string }> = {
  youtube: { bg: 'var(--c7f1d1d)', fg: 'var(--cfecaca)' },
  // Accent, not themed: a brand chip reads the same in either mode.
  instagram: { bg: '#831843', fg: '#fbcfe8' },
  google: { bg: 'var(--c1e293b)', fg: 'var(--c94a3b8)' },
};

function fmtDuration(sec: number | null): string | null {
  if (sec == null) return null;
  const m = Math.floor(sec / 60); const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function timeAgo(iso: string | null, vi: boolean): string | null {
  if (!iso) return null;
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  if (h < 1) return vi ? 'vừa xong' : 'just now';
  if (h < 24) return vi ? `${h} giờ trước` : `${h}h ago`;
  const d = Math.round(h / 24);
  return vi ? `${d} ngày trước` : `${d}d ago`;
}

export function TrendsTab({ token, vi, isMobile, extraLinks, onMakePost, canRefresh }: Props) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [raw, setRaw] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'youtube' | 'instagram'>('all');
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const feed: TrendFeed | null = raw ? (vi ? raw : (raw.en ?? raw)) : null;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setRaw(await apiFetch<Envelope>('/content/trends', { token }));
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function refresh() {
    if (refreshing || !token) return;
    setRefreshing(true);
    try { await apiFetch('/content/trends/refresh', { method: 'POST', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setRefreshing(false); }
  }

  const items = (feed?.items ?? []).filter((c) => filter === 'all' || c.source === filter);
  const shown = showAll ? items : items.slice(0, isMobile ? 4 : 8);
  const anyConfigured = Boolean(feed && (feed.sources.youtube.configured || feed.sources.google.configured || feed.sources.instagram.connected || feed.sources.pinterest?.configured));
  const anyFailed = Boolean(feed && (feed.sources.youtube.error || feed.sources.google.error || feed.sources.instagram.error || feed.sources.pinterest?.error));
  const cols = isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))';

  const sectionTitle = (text: string, sub: string, right?: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{text}</div>
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 3 }}>{sub}</div>
      </div>
      {right}
    </div>
  );

  return (
    <>
      {/* ================= layer 1: the feeds ================= */}
      <div style={{ ...ui.card, marginBottom: 14, padding: isMobile ? 14 : 18 }}>
        {sectionTitle(
          T('Đang lên trong ngành', 'Trending in your trade right now'),
          feed?.regionLabel
            ? T(`Kéo về mỗi sáng cho ngành của tiệm tại ${feed.regionLabel}, xếp theo tốc độ tăng 7 ngày qua. Mẫu nào trùng dịch vụ tiệm đang bán thì được đánh dấu.`,
                `Pulled every morning for your trade in ${feed.regionLabel}, ranked by growth over the last 7 days. Anything that matches a service you sell is marked.`)
            : T('Kéo về mỗi sáng cho ngành của tiệm, xếp theo tốc độ tăng 7 ngày qua.',
                'Pulled every morning for your trade, ranked by growth over the last 7 days.'),
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 20,
              background: 'var(--c0f172a)', border: '1px solid var(--c334155)', fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: feed?.fetchedAt && !feed.stale ? '#22c55e' : '#f59e0b', display: 'inline-block' }} />
              {feed?.fetchedAt
                ? T(`Cập nhật ${timeAgo(feed.fetchedAt, true)}`, `Updated ${timeAgo(feed.fetchedAt, false)}`)
                : T('Chưa có lần kéo nào', 'No pull yet')}
            </div>
            {canRefresh && (
              <button onClick={refresh} disabled={refreshing} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)', opacity: refreshing ? 0.6 : 1 }}>
                {refreshing ? T('Đang kéo…', 'Pulling…') : T('Kéo lại', 'Pull again')}
              </button>
            )}
          </div>,
        )}

        {/* filter + legend */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          {([['all', T('Tất cả', 'All sources')], ['youtube', 'YouTube'], ['instagram', 'Instagram']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} style={{
              padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${filter === k ? '#6366f1' : 'var(--c334155)'}`,
              background: filter === k ? '#6366f1' : 'transparent', color: filter === k ? '#fff' : 'var(--c94a3b8)',
            }}>{label}</button>
          ))}
          <div style={{ flexGrow: 1 }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--c64748b)' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#22c55e' }} />
            {T('trùng dịch vụ tiệm bán', 'matches a service you sell')}
          </div>
        </div>

        {err && <div style={{ fontSize: 12.5, color: '#fca5a5', marginBottom: 10 }}>{err}</div>}

        {loading && !feed ? (
          <div style={{ fontSize: 13, color: 'var(--c64748b)', padding: '18px 0' }}>{T('Đang tải…', 'Loading…')}</div>
        ) : !shown.length ? (
          <div style={{ padding: '18px 14px', borderRadius: 10, background: 'var(--c0f172a)', border: '1px dashed var(--c334155)', fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
            {!anyConfigured
              ? T('Lumio đang bật nguồn dữ liệu cho bảng này. Trong lúc chờ, phần "Tự tra cứu" bên dưới vẫn dùng được.',
                  'Lumio is switching on the data feeds for this board. Until then, the "Look it up yourself" section below still works.')
              : feed?.fetchedAt
                ? T('Không có mục nào khớp bộ lọc này.', 'Nothing matches this filter.')
                : anyFailed
                  ? T('Lần kéo gần nhất bị lỗi — lý do ghi ở dòng nguồn ngay dưới. Sửa xong bấm "Kéo lại".',
                      'The last pull failed — the reason is on the source line just below. Fix it and press "Pull again".')
                  : T('Lần kéo đầu tiên chạy trong đêm nay. Sáng mai mở lại là có.',
                      'The first pull runs tonight. Check back in the morning.')}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12 }}>
            {shown.map((c) => (
              <div key={`${c.source}:${c.id}`} style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ position: 'relative', display: 'block', height: isMobile ? 120 : 150, background: 'var(--c1e293b)' }}>
                  {c.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c64748b)', fontSize: 12 }}>
                      {T('không có ảnh', 'no picture')}
                    </div>
                  )}
                  <span style={{ position: 'absolute', top: 8, left: 8, padding: '3px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: SOURCE_CHIP[c.source].bg, color: SOURCE_CHIP[c.source].fg }}>
                    {SOURCE_LABEL[c.source]}{c.via && c.via.startsWith('#') ? ` · ${c.via}` : ''}
                  </span>
                  {fmtDuration(c.durationSec) && (
                    <span style={{ position: 'absolute', bottom: 8, right: 8, padding: '3px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, background: 'var(--c0b1120)', color: 'var(--ce2e8f0)' }}>
                      {fmtDuration(c.durationSec)}
                    </span>
                  )}
                </a>
                <div style={{ padding: '11px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8, flexGrow: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ce2e8f0)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.title}</div>
                  {/* Count, pace, age — and a percent ONLY when the same clip
                      was seen yesterday. A percent from one snapshot is a
                      made-up number, and the first build printed one. */}
                  <div style={{ display: 'flex', gap: '4px 8px', alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12, lineHeight: 1.4 }}>
                    {c.countLabel && <span style={{ color: 'var(--ce2e8f0)', fontWeight: 600 }}>{c.countLabel} {c.source === 'youtube' ? T('lượt xem', 'views') : T('lượt thích', 'likes')}</span>}
                    {c.perDayLabel && <span style={{ color: '#22c55e', fontWeight: 700 }}>{c.perDayLabel}</span>}
                    {c.ageLabel && <span style={{ color: 'var(--c64748b)' }}>{c.ageLabel}</span>}
                    {c.growthLabel && <span style={{ color: (c.growthLabel.startsWith('-') || c.growthLabel.startsWith('−')) ? 'var(--c94a3b8)' : '#22c55e', fontWeight: 700, width: '100%' }}>{c.growthLabel}</span>}
                  </div>
                  {(c.matchesService || c.matchesEvent) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {c.matchesService && (
                        <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: 'var(--c14532d)', color: 'var(--cbbf7d0)' }}>
                          {c.matchesService} · {T('tiệm có bán', 'you sell this')}
                        </span>
                      )}
                      {c.matchesEvent && (
                        <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: 'var(--c451a03)', color: 'var(--cfde68a)' }}>{c.matchesEvent}</span>
                      )}
                    </div>
                  )}
                  <div style={{ flexGrow: 1 }} />
                  {/* Both controls are one row of equal height. The link was
                      wrapping to a vertical "O p e n" and stretching the
                      button beside it; a fixed height and nowrap end that. */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                    <button onClick={() => onMakePost(c)} style={{
                      ...ui.primaryBtn, flex: '1 1 auto', minWidth: 0, height: 36, padding: '0 10px', fontSize: 12,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {T('Làm bài theo mẫu này', 'Make a post like this')}
                    </button>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" style={{
                      flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 12px', borderRadius: 8,
                      border: '1px solid var(--c475569)', color: 'var(--c94a3b8)', fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
                    }}>
                      {T('Mở', 'Open')}
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {items.length > shown.length && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <button onClick={() => setShowAll(true)} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)' }}>
              {T(`Xem thêm ${items.length - shown.length}`, `Show ${items.length - shown.length} more`)}
            </button>
          </div>
        )}

        {/* source status — one quiet line, so a missing key is visible where it matters */}
        {feed && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, fontSize: 11.5, color: 'var(--c64748b)' }}>
            {([
              ['YouTube', feed.sources.youtube.configured, feed.sources.youtube.error],
              ['Google Trends', feed.sources.google.configured, feed.sources.google.error],
              ['Instagram', Boolean(feed.sources.instagram.connected), feed.sources.instagram.error],
              ['Pinterest', Boolean(feed.sources.pinterest?.configured), feed.sources.pinterest?.error ?? null],
            ] as const).map(([name, on, e]) => (
              <span key={name} title={e ?? undefined} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: e ? '#f59e0b' : on ? '#22c55e' : 'var(--c475569)', display: 'inline-block' }} />
                {name}{!on ? (name === 'Instagram' ? T(' · chưa kết nối', ' · not connected') : T(' · chưa bật', ' · not on')) : e ? T(' · lỗi lần kéo gần nhất', ' · last pull failed') : ''}
              </span>
            ))}
          </div>
        )}
        {/* The reason, in full, for whoever can fix it. A salon account is not
            that person, so it gets the one-line status above and no stack of
            API errors it cannot act on. */}
        {canRefresh && anyFailed && feed && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {([['YouTube', feed.sources.youtube.error], ['Google Trends', feed.sources.google.error], ['Instagram', feed.sources.instagram.error], ['Pinterest', feed.sources.pinterest?.error ?? null]] as const)
              .filter(([, e]) => e)
              .map(([name, e]) => (
                <div key={name} style={{ fontSize: 11.5, color: '#fbbf24', lineHeight: 1.5, wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {name}: {e}
                </div>
              ))}
          </div>
        )}

        {/* The trade's live vocabulary — mined from the posts already pulled.
            First of the three keyword strips because it is the only one that
            needs no key: a salon with nothing configured still gets this. */}
        {!!feed?.mined?.length && (
          <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14, marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)' }}>
                {T('Ngành đang nói về · rút từ bài đang lên', 'What the trade is talking about · from the posts above')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--c64748b)' }}>
                {T('Số bài nhắc tới, không phải lượt tìm kiếm', 'Posts mentioning it — not search volume')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {feed.mined.map((q) => (
                <div key={q.query} style={{
                  display: 'flex', gap: 8, alignItems: 'center', padding: '7px 12px', borderRadius: 20,
                  background: 'var(--c0f172a)', border: `1px solid ${q.matchesService ? '#22c55e' : 'var(--c334155)'}`,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--ce2e8f0)', fontWeight: 600 }}>{q.query}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c64748b)' }}>
                    {T(`${q.posts} bài`, `${q.posts} posts`)}
                  </span>
                  {q.growthPct != null && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>+{q.growthPct}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* rising searches */}
        {!!feed?.rising?.length && (
          <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14, marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)' }}>
                {T('Tìm kiếm đang tăng · 30 ngày · Google Trends', 'Searches rising · last 30 days · Google Trends')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--c64748b)' }}>{T('Khách gõ gì trước khi đặt lịch', 'What people type before they book')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {feed.rising.map((q) => (
                <div key={q.query} style={{
                  display: 'flex', gap: 8, alignItems: 'center', padding: '7px 12px', borderRadius: 20,
                  background: 'var(--c0f172a)', border: `1px solid ${q.matchesService ? '#22c55e' : 'var(--c334155)'}`,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--ce2e8f0)', fontWeight: 600 }}>{q.query}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>
                    {q.breakout ? T('đột biến', 'breakout') : q.growthPct != null ? `+${q.growthPct}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* rising on Pinterest — same chips, different well: what people PLAN,
            weeks before they search for a salon to do it */}
        {!!feed?.pinterestRising?.length && (
          <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14, marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)' }}>
                {T('Đang lên trên Pinterest · tuần này', 'Rising on Pinterest · this week')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--c64748b)' }}>{T('Khách ghim gì trước khi đi làm đẹp', 'What people pin before they book')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {feed.pinterestRising.map((q) => (
                <div key={q.query} style={{
                  display: 'flex', gap: 8, alignItems: 'center', padding: '7px 12px', borderRadius: 20,
                  background: 'var(--c0f172a)', border: `1px solid ${q.matchesService ? '#22c55e' : 'var(--c334155)'}`,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--ce2e8f0)', fontWeight: 600 }}>{q.query}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#e60023' }}>
                    {q.growthPct != null ? `+${q.growthPct}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ================= layer 2: what Lumio picked ================= */}
      {!!feed?.picks?.length && (
        <div style={{ ...ui.card, marginBottom: 14, padding: isMobile ? 14 : 18 }}>
          {sectionTitle(
            T('Lumio chọn tuần này', 'Lumio picks this week'),
            T('Chọn tay từ những gì số liệu ở trên đưa lên. Một lý do, một danh sách cảnh quay — không phải tự đoán.',
              'Chosen by hand from what the numbers above surfaced. One reason, one shot list — nothing you have to figure out.'),
          )}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {feed.picks.map((p) => (
              <div key={p.id} style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{p.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.body}</div>
                <div style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>Lumio · {fmtInTz(p.at, { month: 'short', day: 'numeric' })}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= layer 3: look it up yourself ================= */}
      {(!!feed?.links?.weekly?.length || !!extraLinks.length) && (
        <div style={{ ...ui.card, marginBottom: 14, padding: isMobile ? 14 : 18 }}>
          {sectionTitle(
            T('Tự tra cứu', 'Look it up yourself'),
            T('Các công cụ đứng sau số liệu ở trên, đã lọc sẵn theo ngành và khu vực. Mở một cái rồi dán chủ đề vào.',
              'The tools behind the numbers above, already filtered to your trade and area. Open one and paste a topic.'),
          )}
          {/* the salon's own topics, ONCE */}
          {!!feed?.links?.weekly?.[0]?.topics?.length && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 11.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)' }}>{T('Thử tìm', 'Try searching')}</span>
              {feed.links.weekly[0].topics!.map((t, i) => (
                <span key={i} title={t.why} style={{
                  padding: '5px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: t.from === 'salon' ? 'var(--c14532d)' : t.from === 'region' ? 'var(--c451a03)' : 'transparent',
                  color: t.from === 'salon' ? 'var(--cbbf7d0)' : t.from === 'region' ? 'var(--cfde68a)' : 'var(--c94a3b8)',
                  border: t.from === 'salon' || t.from === 'region' ? 'none' : '1px solid var(--c334155)',
                }}>{t.label}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            {[...(feed?.links?.weekly ?? []), ...(feed?.links?.monthly ?? []), ...extraLinks].map((l) => (
              <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer" title={l.how} style={{
                display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 9, textDecoration: 'none',
                background: 'var(--c0f172a)', border: '1px solid var(--c334155)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ca5b4fc)', lineHeight: 1.3 }}>{l.title} ↗</div>
                <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{l.what}</div>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
