/** "Bàn 14 + Bàn 15 + Bàn 16" → "14+15+16": a joined bill's tables on one line (tile, badge). One table stays as it is. */
export function shortTables(label: string): string {
  const parts = String(label ?? '').split(/\s*\+\s*/).map((x) => x.replace(/^(?:bàn|table)\s+/i, '').trim()).filter(Boolean);
  return parts.length > 1 ? parts.join('+') : String(label ?? '');
}

/** "Bàn" + the label, without "Bàn Bàn 5" when the tables are already named "Bàn 5". */
export function tableTitle(label: string, vi: boolean): string {
  const l = String(label ?? '').trim();
  return /^(?:bàn|table)\b/i.test(l) ? l : `${vi ? 'Bàn' : 'Table'} ${l}`;
}
