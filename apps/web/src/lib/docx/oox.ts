/**
 * WordprocessingML, written by hand.
 *
 * These are string builders for the handful of constructs the monthly report
 * actually uses — runs, paragraphs, fixed-grid tables, shaded "chips", inline
 * images, a numbered footer. Hand-writing OOXML sounds worse than it is: the
 * grammar is verbose but regular, and owning it means the export needs zero
 * dependencies and produces exactly the layout the client-approved template
 * has — fixed table grids (so LibreOffice cannot rebalance columns), shaded
 * runs for section chips (tiny table cells get stretched), keepNext on every
 * heading (no orphaned titles at page bottoms).
 *
 * Sizes: half-points for text (22 = 11pt), twips for widths (567 ≈ 1cm),
 * EMU for images (360000 = 1cm). Colors are RRGGBB without '#'.
 */

export const esc = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control chars are illegal in XML 1.0 and a single one corrupts the file.
    // Data here includes captions typed by strangers on Instagram.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export const CM = (cm: number): number => Math.round(cm * 567);
export const EMU = (cm: number): number => Math.round(cm * 360000);

export interface RunOpts { b?: boolean; i?: boolean; size?: number; color?: string; fill?: string }

/** A text run. `fill` shades the run itself — that is how section chips are
 *  drawn (a shaded run survives every renderer; a 1.1cm table cell does not). */
export function run(text: string, o: RunOpts = {}): string {
  const pr = [
    o.b ? '<w:b/>' : '',
    o.i ? '<w:i/>' : '',
    o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : '',
    o.color ? `<w:color w:val="${o.color}"/>` : '',
    o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : '',
  ].join('');
  return `<w:r><w:rPr>${pr}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

export interface ParaOpts {
  align?: 'left' | 'center' | 'right';
  before?: number; after?: number;   // twentieths of a point
  keepNext?: boolean;
  /** bottom hairline border — the rule under section heads */
  ruleUnder?: string;
  line?: number;                     // line spacing, twentieths (auto rule)
}

export function para(children: string, o: ParaOpts = {}): string {
  const pr = [
    o.keepNext ? '<w:keepNext/>' : '',
    o.ruleUnder ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${o.ruleUnder}"/></w:pBdr>` : '',
    `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 80}"${o.line ? ` w:line="${o.line}" w:lineRule="auto"` : ''}/>`,
    o.align && o.align !== 'left' ? `<w:jc w:val="${o.align}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${pr}</w:pPr>${children}</w:p>`;
}

export const text = (s: string, r: RunOpts = {}, p: ParaOpts = {}): string => para(run(s, r), p);

// ---- tables ----------------------------------------------------------------

export interface CellOpts { fill?: string; vAlign?: 'top' | 'center'; span?: number }

/** One cell. Width comes from the table grid; repeating it here (with the
 *  fixed layout below) is what stops LibreOffice re-balancing columns. */
export function tc(widthTw: number, content: string, o: CellOpts = {}): string {
  const pr = [
    `<w:tcW w:w="${widthTw}" w:type="dxa"/>`,
    o.span && o.span > 1 ? `<w:gridSpan w:val="${o.span}"/>` : '',
    o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : '',
    '<w:tcMar><w:top w:w="70" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tcMar>',
    o.vAlign ? `<w:vAlign w:val="${o.vAlign}"/>` : '',
  ].join('');
  return `<w:tc><w:tcPr>${pr}</w:tcPr>${content}</w:tc>`;
}

export const tr = (cells: string): string => `<w:tr>${cells}</w:tr>`;

export interface TblOpts { borders?: boolean; borderColor?: string }

/** Fixed-layout table. gridTw are the column widths in twips — the ONLY sizing
 *  authority; autofit is off so every renderer draws the same columns. */
export function tbl(gridTw: number[], rows: string, o: TblOpts = {}): string {
  const bc = o.borderColor ?? 'E6EBF3';
  const borders = o.borders
    ? `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="${bc}"/><w:left w:val="single" w:sz="4" w:color="${bc}"/><w:bottom w:val="single" w:sz="4" w:color="${bc}"/><w:right w:val="single" w:sz="4" w:color="${bc}"/><w:insideH w:val="single" w:sz="4" w:color="${bc}"/><w:insideV w:val="single" w:sz="4" w:color="${bc}"/></w:tblBorders>`
    : '<w:tblBorders><w:top w:val="none" w:sz="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:color="auto"/></w:tblBorders>';
  const total = gridTw.reduce((a, b) => a + b, 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}</w:tblPr><w:tblGrid>${gridTw.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
}

// ---- the template's signature pieces --------------------------------------

export const PALETTE = {
  NAVY: '0F2A52', INDIGO: '4F46E5', INDIGO_SOFT: 'C7D2FE', MUTED: '64748B', BODY: '334155',
  HAIR: 'E6EBF3', FILL_SOFT: 'F4F6FB', FILL_IND: 'EEF2FF',
  GREEN: '059669', RED: 'DC2626', AMBER: 'B45309', GOLD: 'F59E0B',
  FB: '1877F2', IG: 'E1306C', TT: '010101', WHITE: 'FFFFFF',
} as const;

/** "01  TIÊU ĐỀ" — indigo chip run + tracked title, hairline under, keepNext. */
export function sectionHead(num: string, title: string): string {
  return para(
    run(` ${num} `, { b: true, size: 19, color: PALETTE.WHITE, fill: PALETTE.INDIGO }) +
    run('  ' + title, { b: true, size: 22, color: PALETTE.NAVY }),
    { before: 220, after: 110, keepNext: true, ruleUnder: PALETTE.HAIR },
  );
}

/** Full-width navy band that opens a chapter mid-flow (no forced page break —
 *  hand-tuned breaks fit one month's data and misfit every other month's). */
export function chapterBand(letter: string, title: string): string {
  const inner = para(
    run(` ${letter} `, { b: true, size: 26, color: PALETTE.WHITE }) +
    run('  ' + title, { b: true, size: 24, color: PALETTE.INDIGO_SOFT }),
    { after: 0, keepNext: true },
  );
  return tbl([CM(17.4)], tr(tc(CM(17.4), inner, { fill: PALETTE.NAVY, vAlign: 'center' }))) +
    para('<w:r/>', { after: 60 });
}

/** Inline image. The id must be unique per drawing; rId links to the rels. */
export function drawing(rId: string, id: number, wCm: number, hCm: number): string {
  const w = EMU(wCm); const h = EMU(hCm);
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${id}" name="chart${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="chart${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

// ---- fixed document parts --------------------------------------------------

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

/** A4 portrait, 1.8cm side margins → the 17.4cm content width every table
 *  grid in this module assumes. Footer carries the page number. */
export function documentXml(body: string): string {
  return `${XML_HEAD}<w:document ${W_NS}><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1020" w:right="1021" w:bottom="1080" w:left="1021" w:header="567" w:footer="510"/></w:sectPr></w:body></w:document>`;
}

export function footerXml(label: string): string {
  return `${XML_HEAD}<w:ftr ${W_NS}><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr>${run(label + ' · ', { size: 17, color: PALETTE.MUTED })}<w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="17"/><w:color w:val="${PALETTE.MUTED}"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
}

export function stylesXml(): string {
  // One default: Calibri 11pt (full Vietnamese coverage in every Office since
  // 2007), dark-slate body color, tight spacing. Everything else is inline.
  return `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="${PALETTE.BODY}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
}

export function contentTypesXml(imageCount: number): string {
  const hasPng = imageCount > 0 ? '<Default Extension="png" ContentType="image/png"/>' : '';
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasPng}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
}

export function rootRelsXml(): string {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
}

export function documentRelsXml(imageCount: number): string {
  const imgs = Array.from({ length: imageCount }, (_, i) =>
    `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.png"/>`).join('');
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${imgs}</Relationships>`;
}
