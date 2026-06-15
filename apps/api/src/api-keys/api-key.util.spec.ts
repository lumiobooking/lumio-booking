import { generateApiKey, hashApiKey } from './api-key.util';

describe('api-key util', () => {
  it('generates a key with the expected shape', () => {
    const k = generateApiKey();
    expect(k.plaintext.startsWith('lumio_sk_')).toBe(true);
    expect(k.plaintext.length).toBeGreaterThan(40);
    expect(k.keyPrefix.startsWith('lumio_sk_')).toBe(true);
    expect(k.lastFour).toHaveLength(4);
    expect(k.plaintext.endsWith(k.lastFour)).toBe(true);
  });

  it('stores a hash, never the plaintext', () => {
    const k = generateApiKey();
    expect(k.hash).not.toContain(k.plaintext);
    expect(k.hash).toHaveLength(64); // sha256 hex
  });

  it('hash is deterministic and verifies the same key', () => {
    const k = generateApiKey();
    expect(hashApiKey(k.plaintext)).toBe(k.hash);
  });

  it('different keys produce different hashes', () => {
    expect(generateApiKey().hash).not.toBe(generateApiKey().hash);
  });

  it('a wrong key does not match a stored hash', () => {
    const k = generateApiKey();
    expect(hashApiKey('lumio_sk_wrong')).not.toBe(k.hash);
  });
});
