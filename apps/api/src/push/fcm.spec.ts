import { generateKeyPairSync, createVerify } from 'crypto';
import { FCM_PREFIX, isFcmEndpoint, loadServiceAccount, signJwt } from './fcm';

describe('FCM without an SDK', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const sa = { project_id: 'lumio-test', client_email: 'x@lumio-test.iam.gserviceaccount.com', private_key: pem };

  it('reads the service account as JSON or base64, and refuses a partial one', () => {
    const json = JSON.stringify(sa);
    expect(loadServiceAccount(json)?.project_id).toBe('lumio-test');
    expect(loadServiceAccount(Buffer.from(json).toString('base64'))?.client_email).toBe(sa.client_email);
    expect(loadServiceAccount(JSON.stringify({ project_id: 'p' }))).toBeNull();
    expect(loadServiceAccount(undefined)).toBeNull();
    expect(loadServiceAccount('not json')).toBeNull();
  });

  it('signs an RS256 JWT Google will accept the shape of', () => {
    const jwt = signJwt(sa, 1_700_000_000);
    const [h, c, s] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64').toString());
    const claims = JSON.parse(Buffer.from(c, 'base64').toString());
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims.iss).toBe(sa.client_email);
    expect(claims.scope).toContain('firebase.messaging');
    expect(claims.exp - claims.iat).toBe(3600);
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${c}`);
    const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(v.verify(publicKey, sig)).toBe(true);
  });

  it('tells a native token from a web endpoint by its prefix', () => {
    expect(isFcmEndpoint(`${FCM_PREFIX}abc`)).toBe(true);
    expect(isFcmEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(false);
  });
});
