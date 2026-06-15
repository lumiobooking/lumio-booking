import * as bcrypt from 'bcrypt';

const DEFAULT_SALT_ROUNDS = 12;

function saltRounds(): number {
  const fromEnv = Number(process.env.BCRYPT_SALT_ROUNDS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_SALT_ROUNDS;
}

/** Hash a plaintext password (or any secret, e.g. an API key) with bcrypt. */
export function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, saltRounds());
}

/** Compare a plaintext value against a stored bcrypt hash. */
export function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
