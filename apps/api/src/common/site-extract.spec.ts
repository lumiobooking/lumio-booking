import {
  composeSiteText, decodeEntities, internalLinks, jsonLdBlocks, pickPages, readableText, structuredFacts,
} from './site-extract';
import { htmlToText } from './site-reader';

/** A page shaped like the real estate site the bot could not learn anything from. */
const HOME = `<!doctype html><html><head>
<title>Family Smart Homes — Michael Huynh, Realty One Group West</title>
<meta name="description" content="Mua bán nhà tại Orange County. Định giá miễn phí.">
<meta property="og:site_name" content="Family Smart Homes">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"RealEstateAgent",
 "name":"Family Smart Homes","telephone":"+1 (714) 925-2419",
 "email":"hello@familysmarthomes.com","priceRange":"$$",
 "address":{"@type":"PostalAddress","streetAddress":"2134 Main St. Suite 140","addressLocality":"Huntington Beach","addressRegion":"CA","postalCode":"92648"},
 "openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday"],"opens":"09:00","closes":"18:00"}],
 "areaServed":["Anaheim","Irvine","Westminster"],
 "sameAs":["https://facebook.com/fsh"]}
</script>
<script type="application/ld+json">{ this is broken json </script>
</head><body>
<nav><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a><a href="/blog/post-1">Blog</a></nav>
<h1>Find your next home</h1>
<p>We help families buy and sell across Orange County.</p>
<h2>What we do</h2>
<ul><li>Home buying</li><li>Home selling</li><li>Free valuation</li></ul>
<a href="/pricing?ref=nav">Fees</a>
<a href="https://zillow.com/x">Zillow</a>
<a href="/brochure.pdf">Brochure</a>
<footer>© 2026 All rights reserved. Privacy policy. Terms of service.</footer>
</body></html>`;

describe('the facts that were being thrown away with the tags', () => {
  const facts = structuredFacts(HOME);
  const get = (label: string) => facts.find((f) => f.label === label)?.value;

  it('lifts name, phone, email and a full address out of JSON-LD', () => {
    expect(get('Tên')).toBe('Family Smart Homes');
    expect(get('Điện thoại')).toBe('+1 (714) 925-2419');
    expect(get('Email')).toBe('hello@familysmarthomes.com');
    expect(get('Địa chỉ')).toBe('2134 Main St. Suite 140, Huntington Beach, CA, 92648');
  });

  it('reads opening hours out of schema’s own nested shape', () => {
    expect(get('Giờ mở cửa')).toBe('Monday, Tuesday: 09:00–18:00');
  });

  it('keeps the service area and the price band', () => {
    expect(get('Khu vực phục vụ')).toBe('Anaheim, Irvine, Westminster');
    expect(get('Khoảng giá')).toBe('$$');
  });

  it('falls back to meta tags for what JSON-LD did not say', () => {
    expect(get('Mô tả')).toContain('Orange County');
    expect(get('Tiêu đề trang')).toContain('Michael Huynh');
  });

  it('a broken JSON-LD block does not cost us the good ones', () => {
    expect(jsonLdBlocks(HOME)).toHaveLength(1);
    expect(facts.length).toBeGreaterThan(5);
  });

  it('ignores structural entities that say nothing about the business', () => {
    const html = `<script type="application/ld+json">{"@type":"BreadcrumbList","name":"crumbs"}</script>`;
    expect(structuredFacts(html).find((f) => f.value === 'crumbs')).toBeUndefined();
  });

  it('survives a page with no structured data at all', () => {
    expect(() => structuredFacts('<html><body>hi</body></html>')).not.toThrow();
  });
});

describe('text that keeps its shape', () => {
  const text = readableText(HOME);

  it('marks headings and list items so groupings survive', () => {
    expect(text).toContain('## What we do');
    expect(text).toContain('- Home buying');
  });

  it('drops the navigation and the footer boilerplate', () => {
    expect(text).not.toContain('All rights reserved');
    expect(text).not.toContain('Privacy policy');
  });

  it('keeps the real sentences', () => {
    expect(text).toContain('buy and sell across Orange County');
  });

  it('leaves no empty bullets or double blank lines behind', () => {
    expect(text).not.toMatch(/\n-\s*\n/);
    expect(text).not.toMatch(/\n\n\n/);
  });

  it('decodes the entities that used to reach the model as "&amp;"', () => {
    expect(decodeEntities('Tu Nails &amp; Spa &ndash; &#8220;best&#8221; &#x1F600;')).toBe('Tu Nails & Spa – “best” 😀');
    expect(decodeEntities('&unknownthing;')).toBe('&unknownthing;');
  });
});

describe('choosing which other pages to read', () => {
  const links = internalLinks(HOME, 'https://www.familysmarthomes.com/');

  it('keeps same-site pages and drops other sites, files and anchors', () => {
    expect(links).toContain('https://www.familysmarthomes.com/about');
    expect(links.some((l) => l.includes('zillow.com'))).toBe(false);
    expect(links.some((l) => l.endsWith('.pdf'))).toBe(false);
  });

  it('treats www and the bare domain as the same site', () => {
    const l = internalLinks('<a href="https://familysmarthomes.com/about">a</a>', 'https://www.familysmarthomes.com/');
    expect(l).toHaveLength(1);
  });

  it('picks one page per kind, so forty service pages cannot eat the budget', () => {
    const picked = pickPages(links, 'https://www.familysmarthomes.com/', 3);
    expect(picked).toHaveLength(3);
    const paths = picked.map((p) => new URL(p).pathname);
    expect(paths).toContain('/services');
    expect(paths).toContain('/pricing');
    expect(paths).toContain('/about');
    expect(paths).not.toContain('/blog/post-1');
  });

  it('never re-reads the home page', () => {
    const withHome = [...links, 'https://familysmarthomes.com'];
    expect(pickPages(withHome, 'https://www.familysmarthomes.com/', 4).map((p) => new URL(p).pathname))
      .not.toContain('/');
  });

  it('matches on the path, not on a query string that happens to say "about"', () => {
    const l = ['https://x.com/shop?utm=about-us'];
    expect(pickPages(l, 'https://x.com/', 3)).toEqual([]);
  });
});

describe('what the model finally receives', () => {
  const out = composeSiteText([
    { url: 'https://www.familysmarthomes.com/', html: HOME },
    { url: 'https://www.familysmarthomes.com/pricing', html: '<h2>Fees</h2><p>Listing fee 2.5% of sale price.</p>' },
  ]);

  it('puts the hard facts first, labelled, before any prose', () => {
    expect(out.indexOf('THÔNG TIN DOANH NGHIỆP')).toBe(0);
    expect(out).toContain('- Điện thoại: +1 (714) 925-2419');
    expect(out.indexOf('Điện thoại')).toBeLessThan(out.indexOf('Find your next home'));
  });

  it('names each page so a price is not mistaken for a slogan', () => {
    expect(out).toContain('--- Trang /pricing ---');
    expect(out).toContain('Listing fee 2.5%');
  });

  it('skips a page that came back empty rather than printing a bare header', () => {
    const o = composeSiteText([{ url: 'https://x.com/', html: '<html><body>   </body></html>' }]);
    expect(o).not.toContain('--- Trang');
  });

  it('is far richer than the one-page flatten it replaces', () => {
    // Compared against the REAL old extractor, not a hand-rolled imitation of
    // it: htmlToText strips <script> blocks, so every fact that lived in the
    // JSON-LD — the phone, the address, the hours — was invisible to the bot.
    const old = htmlToText(HOME);
    for (const fact of ['+1 (714) 925-2419', '92648', '09:00', 'hello@familysmarthomes.com']) {
      expect(old).not.toContain(fact);
      expect(out).toContain(fact);
    }
    // And the old one swept the furniture in with the content.
    expect(old).toContain('All rights reserved');
    expect(out).not.toContain('All rights reserved');
  });
});
