import { buildProof, GOOGLE_MINIMUM, proofCsv, proofEmail, type ProofRow } from './google-proof';

const row = (name: string, over: Partial<ProofRow> = {}): ProofRow => ({
  id: name, name, slug: name.toLowerCase().replace(/\s+/g, '-'), status: 'ready',
  mapsUrl: `https://maps.google.com/?cid=${name.length}`, bookingLink: { state: 'linked', uri: `https://lumiobooking.com/${name}/gbp` }, ...over,
});

describe('the proof Google asks for', () => {
  it('counts only salons whose profile carries the Lumio link and whose Maps link is known', () => {
    const p = buildProof([
      row('Lux Nail Spa'),
      row('T U Nails'),
      row('Ready Not Linked', { bookingLink: { state: 'skipped', uri: null } }),
      row('Linked No Maps', { mapsUrl: null }),
      row('Broken', { status: 'fix', bookingLink: { state: 'error', uri: null } }),
      row('Demo', { status: 'off' }),
    ]);
    expect(p.merchants.map((m) => m.name)).toEqual(['Lux Nail Spa', 'T U Nails']);
    expect(p.using).toBe(5); // demo / restaurant / switched-off tenants are not merchants
    expect(p.next.map((n) => n.name)).toEqual(['Linked No Maps', 'Ready Not Linked', 'Broken']);
    expect(GOOGLE_MINIMUM).toBe(25);
  });

  it('writes the reply with every merchant, its profile and its landing page', () => {
    const p = buildProof([row('Lux Nail Spa'), row('Demo', { status: 'off' })]);
    const mail = proofEmail(p);
    expect(mail).toContain('1. Lux Nail Spa\n   Google Business Profile: https://maps.google.com/?cid=12\n   Landing page: https://lumiobooking.com/Lux Nail Spa/gbp');
    expect(mail).toContain('Total merchants currently using our reservation system: 1');
    expect(mail).not.toContain('Demo');
    expect(proofCsv(p).split('\n')[1]).toBe('1,"Lux Nail Spa","https://maps.google.com/?cid=12","https://lumiobooking.com/Lux Nail Spa/gbp"');
  });
});
