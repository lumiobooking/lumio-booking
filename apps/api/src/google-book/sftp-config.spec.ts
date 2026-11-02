/**
 * Google's feed drop (Actions Center SFTP): the private key pasted into
 * Render in whatever shape it arrives must reach the SSH library as a PEM it
 * can read, the screen must say what is missing without ever showing the key,
 * and an upload error must say what to change.
 */
import { generateKeyPairSync } from 'crypto';
import { normalizePrivateKey, readSftpEnv, sftpErrorHint } from './sftp-config';
import { allowedCountries, lintTenant } from './feed-lint';
import { buildServicesFeed, serviceDuration, type FeedTenant } from './feed';
import { bookingLinkBlock } from './google-book.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { utils } = require('ssh2') as { utils: { parseKey: (k: string) => unknown } };

const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 1024, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
const parses = (k: string) => !(utils.parseKey(k) instanceof Error);

describe('the private key, however it was pasted', () => {
  it('the real file reads as is', () => {
    expect(parses(normalizePrivateKey(PEM))).toBe(true);
  });
  it('literal \\n, Windows line ends, surrounding quotes', () => {
    expect(parses(normalizePrivateKey(PEM.replace(/\n/g, '\\n')))).toBe(true);
    expect(parses(normalizePrivateKey(PEM.replace(/\n/g, '\r\n')))).toBe(true);
    expect(parses(normalizePrivateKey(`"${PEM.replace(/\n/g, '\\n')}"`))).toBe(true);
  });
  it('everything on one line with spaces (what a single-line web field does to it)', () => {
    const oneLine = PEM.trim().replace(/\n/g, ' ');
    expect(oneLine.includes('\n')).toBe(false);
    expect(parses(normalizePrivateKey(oneLine))).toBe(true);
    expect(normalizePrivateKey(oneLine)).toBe(normalizePrivateKey(PEM));
  });
  it('base64 of the whole file (lumio_rwg.b64)', () => {
    expect(parses(normalizePrivateKey(Buffer.from(PEM).toString('base64')))).toBe(true);
  });
  it('not a key at all → empty', () => {
    expect(normalizePrivateKey('hello')).toBe('');
    expect(normalizePrivateKey('')).toBe('');
    expect(normalizePrivateKey('-----BEGIN RSA PRIVATE KEY----- not base64 !!! -----END RSA PRIVATE KEY-----')).toBe('');
  });
});

describe('what the screen learns from the environment', () => {
  const full = { RWG_SFTP_HOST: 'sftp://partnerupload.google.com/', RWG_SFTP_USER: 'feeds-sandbox-123', RWG_SFTP_KEY: PEM.replace(/\n/g, '\\n') };
  it('complete → a config with the host cleaned and Google\'s port by default', () => {
    const r = readSftpEnv(full);
    expect(r.config).toMatchObject({ host: 'partnerupload.google.com', user: 'feeds-sandbox-123', port: 19321, dir: '/' });
    expect(r.missing).toEqual([]);
    expect(r.keyProblem).toBeNull();
  });
  it('says which variable is missing', () => {
    expect(readSftpEnv({ RWG_SFTP_HOST: 'partnerupload.google.com' }).missing).toEqual(['RWG_SFTP_USER', 'RWG_SFTP_KEY']);
    expect(readSftpEnv({}).config).toBeNull();
  });
  it('the PUBLIC key pasted by mistake, or junk, is named — and the key itself is never returned', () => {
    const pub = readSftpEnv({ ...full, RWG_SFTP_KEY: 'ssh-rsa AAAAB3NzaC1yc2E partners@lumiobooking.com' });
    expect(pub.config).toBeNull();
    expect(pub.keyProblem).toMatch(/không phải khoá riêng|CÔNG KHAI/);
    const r = readSftpEnv(full) as Record<string, unknown>;
    const { config, ...shown } = r;
    expect(JSON.stringify(shown)).not.toMatch(/PRIVATE KEY/);
    expect(config).toBeTruthy();
  });
  it('the SSH error becomes what to change', () => {
    expect(sftpErrorHint('All configured authentication methods failed')).toMatch(/RWG_SFTP_USER/);
    expect(sftpErrorHint('getaddrinfo ENOTFOUND sftp')).toMatch(/partnerupload\.google\.com/);
    expect(sftpErrorHint('connect ETIMEDOUT')).toMatch(/19321/);
  });
});

const salon = (o: Partial<FeedTenant> = {}): FeedTenant => ({
  id: 't-1', slug: 'be-unique', name: 'Be Unique Nails & Spa', phone: '+15125551234', website: null,
  address: { country: 'US', locality: 'Austin', region: 'TX', postalCode: '78701', street: '1 Main St' },
  lat: 30.2, lng: -97.7, currency: 'USD', locale: 'en', cancelNoticeHours: 24, depositRequired: false,
  services: [
    { id: 'a', name: 'Gel Manicure', priceCents: 3500, durationMinutes: 0 },
    { id: 'b', name: 'Pedicure', priceCents: 4000, durationMinutes: 0 },
  ],
  ...o,
});

describe('a menu without lengths still goes to Google', () => {
  it('services with no length are sent with "duration not displayed", and the salon is ready', () => {
    const lint = lintTenant(salon(), { googleLinked: true, enabled: true, countries: ['US', 'CA'] });
    expect(lint.status).toBe('ready');
    expect(lint.feedable).toBe(2);
    // one line for the whole menu, not one per service
    expect(lint.issues.filter((i) => i.code === 'svc_no_duration')).toHaveLength(1);
    expect(lint.issues.find((i) => i.code === 'svc_no_duration')?.message).toMatch(/^2 dịch vụ/);
    const rows = buildServicesFeed([salon()], 'https://lumiobooking.com').data as { service_duration: unknown }[];
    expect(rows.map((r) => r.service_duration)).toEqual([{ duration_interpretation: 'INTERPRETATION_NOT_DISPLAYED' }, { duration_interpretation: 'INTERPRETATION_NOT_DISPLAYED' }]);
    expect(serviceDuration(45)).toEqual({ duration_interpretation: 'INTERPRETATION_EXACT', min_duration_sec: 2700 });
  });
  it('a menu that is all switched off says so', () => {
    const off = lintTenant(salon({ services: [{ id: 'a', name: 'Gel', priceCents: 3500, durationMinutes: 30, isActive: false }] }), { googleLinked: true, enabled: true });
    expect(off.status).toBe('fix');
    expect(off.issues.find((i) => i.code === 'no_services')?.message).toMatch(/đang tắt/);
  });
});

describe('the region Google approved', () => {
  it('US and Canada by default; RWG_COUNTRIES widens it', () => {
    expect(allowedCountries(undefined)).toEqual(['US', 'CA']);
    expect(allowedCountries('us, ca ,au')).toEqual(['US', 'CA', 'AU']);
    expect(allowedCountries('garbage')).toEqual(['US', 'CA']);
  });
  it('an Australian salon stays out of the feed, but still gets its own Book link', () => {
    const au = salon({ address: { country: 'AU', locality: 'Perth', region: 'WA', postalCode: '6016', street: '12 Beach Rd' } });
    const lint = lintTenant(au, { googleLinked: true, enabled: true, countries: ['US', 'CA'] });
    expect(lint.status).toBe('off');
    expect(lint.issues[0].code).toBe('outside_region');
    expect(bookingLinkBlock(lint)).toBeNull();
    // …unless it is also not linked to Google — then the usual reason applies.
    expect(bookingLinkBlock(lintTenant(au, { googleLinked: false, enabled: true, countries: ['US', 'CA'] }))).toMatch(/Chưa nối/);
    // a salon with no structured address is not judged by country
    expect(lintTenant(salon({ address: null, unstructuredAddress: '1 Main St, Austin' }), { googleLinked: true, enabled: true, countries: ['US', 'CA'] }).status).toBe('ready');
  });
});
