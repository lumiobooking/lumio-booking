/**
 * Menu screen helpers. Searching a dish should not depend on accents or
 * case: "pho bo" finds "Phở Bò", "gan bo" finds "Gân bò hầm tiêu xanh".
 */
export function foldText(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
