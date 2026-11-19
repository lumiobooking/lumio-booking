/**
 * rt214 — finding ANY conversation, not only the hundred on screen.
 *
 * The owner: "mục tin nhắn tất cả chỉ có 100 tin trên hệ thống". The list sends
 * a hundred at a time and the search box only looked through those, so a
 * customer from last month could not be found by name at all. Search now runs
 * in the database, over every conversation of this salon.
 *
 * Accent-insensitive like the screen's own filter ("hang" finds "Hằng"), done
 * with plain translate() so no Postgres extension is needed.
 */
const ACCENTED = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const PLAIN = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';

export const FOLD_FROM = ACCENTED;
export const FOLD_TO = PLAIN;

/** The same folding in JS: lower case, no accents, đ → d, single spaces. */
export function foldText(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFC')
    .split('')
    .map((ch) => { const i = ACCENTED.indexOf(ch); return i >= 0 ? PLAIN[i] : ch; })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The LIKE pattern for a search, or null when there is nothing worth asking the
 * database (under two letters). % and _ typed by a person are matched literally.
 */
export function searchPattern(q: unknown): string | null {
  const f = foldText(q).slice(0, 80);
  if (f.length < 2) return null;
  return `%${f.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
