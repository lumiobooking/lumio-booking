import { pooledUrl } from './prisma.service';

describe('rt224 — connection pool size', () => {
  it('asks for 10 connections when the string names none', () => {
    const u = new URL(pooledUrl('postgresql://u:p@ep-x-pooler.us-west-2.aws.neon.tech/db?sslmode=require')!);
    expect(u.searchParams.get('connection_limit')).toBe('10');
    expect(u.searchParams.get('pool_timeout')).toBe('20');
    expect(u.searchParams.get('sslmode')).toBe('require');
    expect(u.password).toBe('p');
  });
  it('the owner’s own values win; non-postgres or empty are left alone', () => {
    expect(new URL(pooledUrl('postgresql://u:p@h/db?connection_limit=4')!).searchParams.get('connection_limit')).toBe('4');
    expect(pooledUrl(undefined)).toBeUndefined();
    expect(pooledUrl('file:./dev.db')).toBe('file:./dev.db');
  });
});
