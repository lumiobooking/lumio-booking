import * as fs from 'fs';
import * as path from 'path';

/**
 * A stand-in for `prisma validate`, because this build environment cannot run it.
 *
 * Prisma's engine binaries are fetched from the network, and in a locked-down
 * CI or sandbox that download is refused — so schema mistakes stay invisible
 * until the deploy, where they take down every service at once. That happened
 * twice in one evening: a `///` doc comment written at the end of a field line,
 * and a relation declared on one model but not the other.
 *
 * These checks catch exactly those two classes plus a couple of neighbours.
 * They are text-level and deliberately shallow — not a replacement for the real
 * validator, just the seatbelt for the mistakes that actually happen.
 */

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');

/** Model name → its body text. */
function models(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SCHEMA))) out.set(m[1], m[2]);
  return out;
}

const ALL = models();
const NAMES = new Set(ALL.keys());

describe('the Prisma schema parses at all', () => {
  it('finds a healthy number of models — a broken regex here would silently pass everything else', () => {
    expect(ALL.size).toBeGreaterThan(40);
  });

  it('has no /// doc comment at the END of a field line', () => {
    // Prisma only accepts /// on a line of its own. A trailing one is a
    // validation error that fails the build for every service.
    const offenders: string[] = [];
    SCHEMA.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*[A-Za-z_]\w*\s+\S/.test(line) && /\S\s+\/\/\//.test(line)) {
        offenders.push(`${i + 1}: ${line.trim()}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe('every relation has BOTH sides', () => {
  // Prisma requires an opposite field on the related model. Declaring only one
  // side compiles in the editor and dies in `prisma generate`.
  const relationFields: { model: string; field: string; target: string }[] = [];
  for (const [model, body] of ALL) {
    for (const line of body.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
      // `name  Target` / `name  Target?` / `name  Target[]`
      const m = /^(\w+)\s+(\w+)(\?|\[\])?(\s|$)/.exec(t);
      if (!m) continue;
      const [, field, target] = m;
      if (NAMES.has(target) && target !== model) relationFields.push({ model, field, target });
    }
  }

  it('found relation fields to check', () => {
    expect(relationFields.length).toBeGreaterThan(20);
  });

  it.each(relationFields.map((r) => [`${r.model}.${r.field} -> ${r.target}`, r] as const))(
    '%s has an opposite field',
    (_label, r) => {
      const targetBody = ALL.get(r.target) ?? '';
      const mentionsBack = new RegExp(`^\\s*\\w+\\s+${r.model}(\\?|\\[\\])?(\\s|$)`, 'm').test(targetBody);
      expect(mentionsBack).toBe(true);
    },
  );
});

describe('the content engine tables are wired the way the code expects', () => {
  it('ContentIdea is tenant-scoped — a salon must never read another salon’s plan', () => {
    const body = ALL.get('ContentIdea') ?? '';
    expect(body).toMatch(/tenantId\s+String/);
    expect(body).toMatch(/@@index\(\[tenantId, forDate\]\)/);
  });

  it('every content table maps to the snake_case name the migration created', () => {
    expect(ALL.get('ContentFormat')).toMatch(/@@map\("content_formats"\)/);
    expect(ALL.get('TrendNote')).toMatch(/@@map\("trend_notes"\)/);
    expect(ALL.get('ContentIdea')).toMatch(/@@map\("content_ideas"\)/);
  });

  it('the migration creates the same tables the schema declares', () => {
    const dir = path.join(__dirname, '../../prisma/migrations/20260830100000_content_engine');
    const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8');
    for (const t of ['content_formats', 'trend_notes', 'content_ideas']) {
      expect(sql).toContain(`"${t}"`);
    }
  });
});
