import { cleanSourceUrl, docText, docsBlock, flattenJson, sourcesFrom, type KnowledgeSource } from './knowledge-sources';

describe('Học từ link — the AI reads the business own documents', () => {
  it('only public http(s) links', () => {
    expect(cleanSourceUrl('https://lumioagency.work/api/public/pricing')).toBe('https://lumioagency.work/api/public/pricing');
    for (const bad of ['ftp://x.com/a', 'http://localhost:3000', 'http://10.0.0.5/x', 'http://169.254.169.254/latest', 'javascript:alert(1)', '']) expect(cleanSourceUrl(bad)).toBeNull();
  });
  it('JSON becomes named lines a model can quote', () => {
    const lines = flattenJson({ currency: 'USD', marketing_packages: [{ name: 'Boost', price_per_month: 179, channels: ['Facebook', 'TikTok'] }] });
    expect(lines).toContain('currency: USD');
    expect(lines).toContain('marketing packages > Boost > price per month: 179');
    expect(lines).toContain('marketing packages > Boost > channels: Facebook, TikTok');
  });
  it('picks JSON, HTML or text from the response', () => {
    expect(docText('{"a":{"b":1}}', 'application/json')).toBe('a > b: 1');
    expect(docText('<html><body><h1>Menu</h1><p>Pho $12</p></body></html>', 'text/html')).toMatch(/Menu[\s\S]*Pho \$12/);
    expect(docText('Gel $30', 'text/plain')).toBe('Gel $30');
  });
  it('the prompt block says the documents win, and leaves out links that are off or empty', () => {
    const s = (o: Partial<KnowledgeSource>): KnowledgeSource => ({ id: 'x', url: 'https://a.com/p', label: 'Prices', on: true, text: 'Boost: 179', chars: 10, fetchedAt: '2026-11-16T05:00:00Z', error: null, errorAt: null, ...o });
    const b = docsBlock([s({}), s({ id: 'y', label: 'Old', on: false, text: 'Boost: 99' }), s({ id: 'z', label: 'Empty', text: '' })]);
    expect(b).toMatch(/these documents win/);
    expect(b).toMatch(/Boost: 179/);
    expect(b).not.toMatch(/Boost: 99/);
    expect(docsBlock([])).toBe('');
  });
  it('reads stored rows defensively and caps at 5', () => {
    expect(sourcesFrom(null)).toEqual([]);
    expect(sourcesFrom(Array.from({ length: 9 }, (_, i) => ({ id: String(i), url: `https://a.com/${i}` }))).length).toBe(5);
  });
});
