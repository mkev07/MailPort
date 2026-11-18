import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { z } from 'zod';
import { MailPortError, parseAccounts, type Account } from './schema.js';

// Draft v1 fixes the entire cryptographic suite, including KDF work factors.
// Never use work factors supplied by an untrusted vault file.
const SUITE = 'scrypt-n32768-r8-p1-aes256gcm';
const AAD = Buffer.from(`MailPort:1:${SUITE}`, 'utf8');
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .refine(s => Buffer.from(s, 'base64').toString('base64') === s);
const bytes = (length: number) => base64.refine(s => Buffer.from(s, 'base64').length === length);
const EnvelopeSchema = z.strictObject({
  format: z.literal('mailport-vault'),
  version: z.literal(1),
  suite: z.literal(SUITE),
  salt: bytes(16),
  nonce: bytes(12),
  ciphertext: base64.min(4).max(MAX_FILE_BYTES),
  tag: bytes(16),
});

function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024) {
    throw new MailPortError('INVALID_PASSWORD');
  }
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(new MailPortError('UNLOCK_FAILED'));
      else resolve(key);
    });
  });
}

/** Returns encrypted JSON. Callers own safe file storage and password entry. */
export async function sealVault(accounts: unknown, password: string): Promise<string> {
  const validated = parseAccounts(accounts);
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await derive(password, salt);
  const plaintext = Buffer.from(JSON.stringify({ accounts: validated }), 'utf8');
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = JSON.stringify({
      format: 'mailport-vault', version: 1, suite: SUITE,
      salt: salt.toString('base64'), nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    });
    if (Buffer.byteLength(envelope, 'utf8') > MAX_FILE_BYTES) throw new MailPortError('INVALID_VAULT');
    return envelope;
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

/** Unlocks into process memory. Never log the returned accounts. */
export async function unlockVault(serialized: string, password: string): Promise<Account[]> {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
    throw new MailPortError('INVALID_VAULT');
  }
  let raw: unknown;
  try { raw = JSON.parse(serialized); } catch { throw new MailPortError('INVALID_VAULT'); }
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) throw new MailPortError('INVALID_VAULT');
  const envelope = parsed.data;
  const key = await derive(password, Buffer.from(envelope.salt, 'base64'));
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    const payload = z.strictObject({ accounts: z.unknown() }).parse(JSON.parse(plaintext.toString('utf8')));
    return parseAccounts(payload.accounts);
  } catch {
    throw new MailPortError('UNLOCK_FAILED');
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}
