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

describe('nothing untyped reaches Prisma', () => {
  /**
   * The generated Prisma client is not available here — `prisma generate`
   * needs a network download that is refused — so `tsc` in this environment
   * cannot see that a value is the wrong type for a column. The deploy machine
   * can, and it says so by failing every service at once.
   *
   * Scope note, learned the hard way: I first wrote a second check here that
   * banned `data: Record<string, unknown>` outright, on the theory that Prisma
   * rejects an index-signature object. It does not — customers, supplies and
   * email-campaigns have all been shipping that exact shape for months. The
   * ban flagged three healthy call sites and would have trained us to ignore
   * this file. A guard that cries wolf is worse than no guard, so it is gone
   * and only the rule that caught a real failure remains.
   */
  const apiSrc = path.join(__dirname, '..');

  it('values parsed out of model JSON are coerced before they are written', () => {
    // A model's reply is `Record<string, unknown>`. Every field lifted out of
    // it must pass through String()/Number()/a typeof guard on the way into a
    // create() — `idea.formatName ?? null` is `unknown` and fails the build.
    const src = fs.readFileSync(path.join(apiSrc, 'content/content.service.ts'), 'utf8');
    const block = /contentIdea\.create\(\{([\s\S]*?)\n\s*\}\)/.exec(src);
    expect(block).not.toBeNull();
    const raw = (block as RegExpExecArray)[1]
      .split(/\r?\n/)
      .filter((l) => /\bidea\.\w+/.test(l))
      .filter((l) => !/String\(|Number\(|typeof /.test(l));
    expect(raw).toEqual([]);
  });
});

describe('no test is allowed to reach the real API', () => {
  /**
   * This used to be a list of function names known to call out — refreshFor,
   * generateForTenant, runAgent — and any spec touching one had to stub fetch.
   * It caught the bug it was written for and missed the very next one, because
   * `planFor` was not on the list and `planFor` reaches the US Census.
   *
   * That is the flaw in naming hazards one at a time: the list only ever
   * describes the failures that already happened. So the enforcement moved to
   * jest.setup.js, which replaces `fetch` with one that throws for EVERY test in
   * both projects. What is left here is checking that the block is still wired
   * in — because a guard that silently stops running is worse than none.
   */
  const root = path.join(__dirname, '../../../..');

  it('the global fetch block exists and throws', () => {
    const setup = fs.readFileSync(path.join(root, 'jest.setup.js'), 'utf8');
    expect(setup).toMatch(/globalThis\.fetch\s*=/);
    expect(setup).toMatch(/Test tried to reach the network/);
  });

  it('both jest projects load it', () => {
    const cfg = fs.readFileSync(path.join(root, 'jest.config.js'), 'utf8');
    const hooks = cfg.match(/setupFilesAfterEnv/g) ?? [];
    expect(hooks.length).toBe(2);
  });

  it('is actually in force inside this very test', () => {
    // The strongest available proof: if the block were missing, this resolves.
    return expect(fetch('https://example.invalid/should-never-be-called'))
      .rejects.toThrow(/Test tried to reach the network/);
  });
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

describe('nothing shown to a salon sends it to a screen only we can open', () => {
  /**
   * Super Admin is OUR staff's console. A salon cannot open it.
   *
   * So every "fill this in at Super Admin" the salon reads is an instruction it
   * is unable to follow, for data it has usually already given us somewhere
   * else — and the salon's screen sits broken until an employee of ours happens
   * to notice. That is what "Business not described yet — fill in the city and
   * state in Super Admin" was: a dead end printed in the salon's own dashboard.
   *
   * Comments may say "Super Admin" freely; they explain the system to us. Only
   * strings the salon can read are checked, and only in the salon-facing engine.
   */
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.spec\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(__dirname, '../content'));
  const salonPage = path.join(__dirname, '../../../web/src/app/salon/content/page.tsx');
  if (fs.existsSync(salonPage)) files.push(salonPage);

  it('has files to check — an empty sweep would pass silently', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never says "Super Admin" inside a string the salon reads', () => {
    const offenders: string[] = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        if (/['"`][^'"`]*Super Admin/i.test(line)) {
          offenders.push(`${path.basename(f)}:${i + 1}: ${t}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('the self-reschedule column exists in schema AND migration', () => {
  /**
   * A column added to schema.prisma with no migration is a build that passes
   * locally and a runtime error on the deploy — the client knows the field,
   * the database does not. This sandbox cannot run `prisma migrate`, so the
   * pairing is checked as text, the same way the relation check is.
   */
  it('is declared on Appointment', () => {
    expect(ALL.get('Appointment')).toMatch(/selfRescheduleCount\s+Int\s+@default\(0\)/);
  });

  it('has a migration that adds it', () => {
    const dir = path.join(__dirname, '../../prisma/migrations');
    const sql = fs.readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql')))
      .map((d) => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "selfRescheduleCount"/i);
  });
});

describe('the weekly archive is declared in schema AND migration', () => {
  /**
   * The plan used to be recomputed on every read and stored nowhere, so last
   * week's plan ceased to exist the moment Monday arrived. This table is the
   * fix, and a table in schema.prisma with no migration is a build that passes
   * locally and a runtime error on the deploy.
   */
  it('keeps the system version and the team edit side by side', () => {
    const body = ALL.get('ContentWeek') ?? '';
    // Both, always. Without the generated side nobody can answer "what did the
    // system suggest, and did our change do better" — which is the only way
    // this feature ever improves.
    expect(body).toMatch(/generated\s+Json/);
    expect(body).toMatch(/edited\s+Json\?/);
    expect(body).toMatch(/@@unique\(\[tenantId, weekKey\]\)/);
    expect(body).toMatch(/@@map\("content_weeks"\)/);
  });

  it('is tenant-scoped — one salon must never read another salon’s plan', () => {
    expect(ALL.get('ContentWeek')).toMatch(/tenantId\s+String/);
    expect(ALL.get('ContentWeek')).toMatch(/onDelete: Cascade/);
  });

  it('has a migration that creates it', () => {
    const dir = path.join(__dirname, '../../prisma/migrations');
    const sql = fs.readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql')))
      .map((d) => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "content_weeks"/i);
    expect(sql).toMatch(/content_weeks_tenantId_weekKey_key/);
  });
});

describe('the publishing queue is declared in schema AND migration', () => {
  it('belongs to a tenant and cascades with it', () => {
    // A post is published to a Facebook Page in public, under a salon's brand.
    // A queue row that outlives its tenant is a row that can still fire.
    const body = ALL.get('ScheduledPost') ?? '';
    expect(body).toMatch(/tenantId\s+String/);
    expect(body).toMatch(/onDelete: Cascade/);
    expect(body).toMatch(/@@map\("scheduled_posts"\)/);
  });

  it('carries media as an ordered list, not one image column', () => {
    // Order IS the content for a carousel: item one is the feed thumbnail and
    // the square on the profile grid, and the only one most people ever see.
    // A single imageUrl cannot express that, and cannot express video at all.
    const body = ALL.get('ScheduledPost') ?? '';
    expect(body).toMatch(/media\s+Json/);
    // The legacy column stays: rows queued before media[] existed must keep
    // publishing rather than silently losing their picture on deploy.
    expect(body).toMatch(/imageUrl\s+String\?/);
  });

  it('has a migration that adds media AND carries the old images across', () => {
    const dir = path.join(__dirname, '../../prisma/migrations');
    const sql = fs.readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql')))
      .map((d) => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "media"/i);
    // Adding the column without the backfill would blank every queued post's
    // picture the moment this deploys.
    expect(sql).toMatch(/jsonb_build_object\('url', "imageUrl"/);
  });

  it('stores no page id and no access token on the post', () => {
    // The Page and its token are read from MessengerPage at send time. Copying
    // a token onto a queue row would outlive the salon disconnecting its Page
    // and add one more place a leak can come from.
    const body = ALL.get('ScheduledPost') ?? '';
    expect(body).not.toMatch(/pageToken/);
    expect(body).not.toMatch(/pageId/);
    expect(body).not.toMatch(/igId/);
  });

  it('records when its uploaded files were cleaned from storage', () => {
    // Facebook and Instagram keep their own copy, so a purged post is unaffected
    // — but without this the calendar draws a broken image, and the sweep
    // re-examines the same rows for ever.
    expect(ALL.get('ScheduledPost') ?? '').toMatch(/mediaPurgedAt\s+DateTime\?/);
  });

  it('has a migration for it', () => {
    const dir = path.join(__dirname, '../../prisma/migrations');
    const sql = fs.readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql')))
      .map((d) => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "mediaPurgedAt"/i);
  });

  it('indexes both the salon’s own view and the scheduler’s cross-tenant sweep', () => {
    const body = ALL.get('ScheduledPost') ?? '';
    expect(body).toMatch(/@@index\(\[tenantId, status, scheduledAt\]\)/);
    expect(body).toMatch(/@@index\(\[status, scheduledAt\]\)/);
  });

  it('has a migration that creates it', () => {
    const dir = path.join(__dirname, '../../prisma/migrations');
    const sql = fs.readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql')))
      .map((d) => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "scheduled_posts"/i);
    expect(sql).toMatch(/scheduled_posts_status_scheduledAt_idx/);
  });
});

describe('the team ↔ salon thread is declared in schema AND migration', () => {
  it('stores which side wrote each message rather than deriving it', () => {
    // A support token carries a SALON_ADMIN role by design. Working the side
    // out at READ time would recolour history the moment the same person
    // signed in the other way.
    expect(ALL.get('ContentMessage')).toMatch(/side\s+String/);
    expect(ALL.get('ContentMessage')).toMatch(/authorName\s+String/);
  });

  it('is tenant-scoped and addressed by subject', () => {
    const body = ALL.get('ContentMessage') ?? '';
    expect(body).toMatch(/tenantId\s+String/);
    expect(body).toMatch(/subject\s+String/);
    expect(body).toMatch(/@@index\(\[tenantId, subject, createdAt\]\)/);
    expect(body).toMatch(/@@map\("content_messages"\)/);
  });

  it('has a migration that creates it', () => {
    const dir = path.join(__dirname, '../../prisma/migrations');
    const sql = fs.readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql')))
      .map((d) => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "content_messages"/i);
  });
});

describe('the thread state that lets the channel survive a year', () => {
  /**
   * Almost everything an inbox row needs is derivable from the messages. Two
   * things are not, and both are what stop this silting up: WHO is handling a
   * thread, and whether it is CLOSED. A queue nobody owns is one everybody
   * assumes somebody else answered; a discussion that can never end becomes a
   * wall, and a wall gets ignored.
   */
  it('carries an owner and a resolution', () => {
    const body = ALL.get('ContentThread') ?? '';
    expect(body).toMatch(/assigneeId\s+String\?/);
    expect(body).toMatch(/resolvedAt\s+DateTime\?/);
    expect(body).toMatch(/lastMessageAt\s+DateTime/);
    expect(body).toMatch(/@@unique\(\[tenantId, subject\]\)/);
  });

  it('can be sorted across salons without touching the messages', () => {
    // The cross-salon queue orders by this. An index-less sort over every
    // message in the platform is the query that gets slow in month four.
    expect(ALL.get('ContentThread')).toMatch(/@@index\(\[lastMessageAt\]\)/);
  });

  it('has a migration that creates it', () => {
    const dir = path.join(__dirname, '../../prisma/migrations');
    const sql = fs.readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql')))
      .map((d) => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "content_threads"/i);
    expect(sql).toMatch(/content_threads_tenantId_subject_key/);
  });
});
