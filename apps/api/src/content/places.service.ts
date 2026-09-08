import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { competitionPicture, type CompetitionPicture, type NearbyPlace } from './competition';

/**
 * Who else the customer sees, from Google's own index.
 *
 * WHY THIS IS A NETWORK CALL AND NOT A TABLE OF ASSUMPTIONS
 *
 * "How competitive is this area" is the first question an owner asks and the
 * easiest one to answer with a confident-sounding invention. A number nobody
 * can check is worse than no number, because the owner will repeat it to her
 * husband and spend money on it. So this reads the real thing: Google's Places
 * index, the same list the customer scrolls, and nothing is shown at all when
 * the key is missing or the call fails.
 *
 * WHAT IT COSTS AND HOW THAT IS KEPT SMALL
 *
 * A Text Search is billed per call, so the answer is cached on the tenant for
 * a month. A town's shops and their review counts do not move meaningfully in
 * four weeks, and a salon opened twice a day for a year would otherwise cost
 * more in lookups than the information is worth. One call per salon per month
 * is a few cents a year.
 *
 * NO KEY, NO GUESSING. Without GOOGLE_PLACES_API_KEY this returns null and the
 * screens that use it show nothing, rather than falling back to a made-up
 * picture of the neighbourhood.
 */

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = 'places.displayName,places.rating,places.userRatingCount,places.formattedAddress';
const MAX_AGE_MS = 30 * 86_400_000;
const SETTING_KEY = 'competition_scan';

interface Cached {
  fetchedAt: string;
  query: string;
  places: NearbyPlace[];
}

@Injectable()
export class PlacesService {
  private readonly log = new Logger(PlacesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private key(): string | null {
    return this.config.get<string>('GOOGLE_PLACES_API_KEY')?.trim() || null;
  }

  configured(): boolean {
    return Boolean(this.key());
  }

  /**
   * The neighbourhood, read once a month.
   *
   * `trade` and `where` are the salon's own words — the trade from its
   * playbook and the town from its profile. A blank town means the scan is
   * skipped rather than run against the whole country, which would return a
   * league table of shops nobody near this salon has heard of.
   */
  async scan(tenantId: string, opts: {
    trade: string; city: string | null; region: string | null; postalCode: string | null; salonName: string | null;
  }): Promise<CompetitionPicture | null> {
    const where = opts.postalCode || [opts.city, opts.region].filter(Boolean).join(', ');
    if (!where) return null;
    const query = `${opts.trade} in ${where}`;

    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: SETTING_KEY }, select: { id: true, value: true } })
      .catch(() => null);
    const cached = (row?.value ?? null) as Cached | null;
    const fresh = cached
      && cached.query === query
      && Date.now() - Date.parse(cached.fetchedAt || '') < MAX_AGE_MS
      && Array.isArray(cached.places);
    if (fresh) return this.picture(cached!.places, opts.salonName);

    const places = await this.fetch(query).catch((e) => {
      this.log.warn(`places scan ${tenantId}: ${e instanceof Error ? e.message : e}`);
      return null;
    });
    // A failed call must not throw away last month's answer: a stale picture of
    // the town is worth far more than a blank card, and it is labelled with the
    // date it was taken.
    if (!places) return cached ? this.picture(cached.places, opts.salonName) : null;

    const next: Cached = { fetchedAt: new Date().toISOString(), query, places };
    if (row) await this.prisma.setting.update({ where: { id: row.id }, data: { value: next as never } }).catch(() => undefined);
    else await this.prisma.setting.create({ data: { tenantId, key: SETTING_KEY, value: next as never } }).catch(() => undefined);
    return this.picture(places, opts.salonName);
  }

  /**
   * Which of the returned places is this salon.
   *
   * Matched on a normalised name rather than an id: the platform does not
   * store a Places id for a tenant, and a salon whose Google listing is named
   * slightly differently from its Lumio account is the normal case, not the
   * exception. A miss is reported as a miss — the picture then says the
   * profile could not be found, which is itself the most useful finding.
   */
  private picture(places: NearbyPlace[], salonName: string | null): CompetitionPicture | null {
    const me = norm(salonName);
    const marked = places.map((p) => (me && norm(p.name) === me ? { ...p, isMine: true } : p));
    return competitionPicture(marked);
  }

  private async fetch(textQuery: string): Promise<NearbyPlace[] | null> {
    const key = this.key();
    if (!key) return null;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELDS,
      },
      body: JSON.stringify({ textQuery, maxResultCount: 20 }),
    });
    if (!res.ok) throw new Error(`Places ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
    const data = (await res.json()) as {
      places?: { displayName?: { text?: string }; rating?: number; userRatingCount?: number }[];
    };
    return (data.places ?? [])
      .map((p) => ({
        name: String(p.displayName?.text ?? '').trim(),
        rating: typeof p.rating === 'number' ? p.rating : null,
        reviews: Math.max(0, Math.round(Number(p.userRatingCount) || 0)),
      }))
      .filter((p) => p.name);
  }
}

/** Names compared without case, accents, punctuation or the words every shop uses. */
function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(nail|nails|salon|spa|studio|beauty|the|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
