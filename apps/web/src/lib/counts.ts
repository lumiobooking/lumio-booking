/**
 * Numbers the way a phone screen says them.
 *
 * "1.234.567 lượt xem" is a figure; "1,2Tr lượt xem" is a fact a shop owner
 * reads in half a second. Vietnamese uses a decimal comma and "K / Tr" for
 * thousand / million (triệu); English uses a point and "K / M".
 */
export function compactCount(n: number, vi: boolean): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  const one = (x: number) => {
    const s = (Math.round(x * 10) / 10).toString();
    return vi ? s.replace('.', ',') : s;
  };
  if (n >= 1_000_000_000) return `${one(n / 1_000_000_000)}${vi ? 'Tỷ' : 'B'}`;
  if (n >= 1_000_000) return `${one(n / 1_000_000)}${vi ? 'Tr' : 'M'}`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${one(n / 1000)}K`;
  return String(Math.round(n));
}

/** "3 ngày trước" / "3 days ago" — rough on purpose, this is a feel, not a log. */
export function ageOf(iso: string, vi: boolean, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = Math.max(0, Math.floor((now - t) / 86_400_000));
  if (d === 0) return vi ? 'hôm nay' : 'today';
  if (d === 1) return vi ? 'hôm qua' : 'yesterday';
  if (d < 7) return vi ? `${d} ngày trước` : `${d} days ago`;
  if (d < 30) { const w = Math.round(d / 7); return vi ? `${w} tuần trước` : `${w} week${w > 1 ? 's' : ''} ago`; }
  const m = Math.round(d / 30);
  return vi ? `${m} tháng trước` : `${m} month${m > 1 ? 's' : ''} ago`;
}
