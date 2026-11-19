import { createHash, randomBytes } from 'node:crypto';
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from '@hpke/core';
import { z } from 'zod';
import { configureAccount, type ImportResult } from './import.js';
import { parseAccounts, type Account } from './schema.js';

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});
const requestFormat = 'mailport-import-request';
const maxPackageBytes = 4 * 1024 * 1024;
const lifetimeSeconds = 15 * 60;
const packageSchema = z.strictObject({
  format: z.literal('mailport-transfer'),
  version: z.literal(1),
  requestId: z.string(),
  enc: z.string(),
  ciphertext: z.string(),
});
const payloadSchema = z.strictObject({ accounts: z.unknown() });
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();
const formatCode = (hash: Buffer) =>
  hash.subarray(0, 8).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');

type TransferErrorCode =
  | 'INVALID_CLIENT_NAME'
  | 'INVALID_TRANSFER_PACKAGE'
  | 'CODE_MISMATCH'
  | 'WRONG_RECIPIENT'
  | 'TRANSFER_USED'
  | 'TRANSFER_EXPIRED'
  | 'TRANSFER_BUSY'
  | 'TRANSFER_CLOSED'
  | 'DIFFERENT_PACKAGE';

export class MailPortTransferError extends Error {
  constructor(public readonly code: TransferErrorCode) {
    super(code);
    this.name = 'MailPortTransferError';
  }
}

/** Save credentials to the client's secure store before resolving. Repeated calls
 * for the same account must repair or update the existing record without duplicates. */
export interface TransferAdapter {
  upsertAccount(account: Account): Promise<void>;
}

function packageHash(serialized: string) {
  if (Buffer.byteLength(serialized, 'utf8') > maxPackageBytes) {
    throw new MailPortTransferError('INVALID_TRANSFER_PACKAGE');
  }
  return sha256(serialized);
}

/** Display this to compare against the code shown by the exporting vault. */
export function transferPackageCode(serialized: string): string {
  return formatCode(packageHash(serialized));
}

function decodeBase64(value: string, validLength: (length: number) => boolean): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (!validLength(bytes.length) || bytes.toString('base64') !== value) {
    throw new MailPortTransferError('INVALID_TRANSFER_PACKAGE');
  }
  return bytes;
}

/** One private key per request, held in memory for the lifetime of this session. */
export class ImportRequestSession {
  #key: CryptoKey | undefined;
  #deadlineTimer: NodeJS.Timeout;
  #state: 'open' | 'used' | 'expired' | 'closed' = 'open';
  #busy = false;
  #acceptedHash: Buffer | undefined;
  #saved = new Map<string, ImportResult>();

  private constructor(
    key: CryptoKey,
    private readonly requestId: string,
    public readonly requestFile: string,
    public readonly verificationCode: string,
    public readonly expiresAt: number,
    private readonly info: Buffer,
  ) {
    this.#key = key;
    this.#deadlineTimer = setTimeout(() => this.#expire(), expiresAt * 1000 - Date.now());
    this.#deadlineTimer.unref();
  }

  static async create(clientName: string): Promise<ImportRequestSession> {
    if (!/^[ -~]{1,80}$/.test(clientName) || clientName.trim() !== clientName) {
      throw new MailPortTransferError('INVALID_CLIENT_NAME');
    }
    const keys = await suite.kem.generateKeyPair();
    const publicKey = Buffer.from(await suite.kem.serializePublicKey(keys.publicKey)).toString('base64');
    const requestId = randomBytes(16).toString('base64');
    const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
    const requestFile = JSON.stringify({
      format: requestFormat, version: 1, requestId, clientName, expiresAt, publicKey,
    });
    const digest = sha256([requestFormat, '1', requestId, expiresAt, clientName, publicKey].join('\n'));
    const info = Buffer.concat([Buffer.from('MailPort:transfer:1:'), digest]);
    return new ImportRequestSession(keys.privateKey, requestId, requestFile, formatCode(digest), expiresAt, info);
  }

  #expire() {
    if (this.#state === 'open') this.#finish('expired');
  }

  #finish(state: 'used' | 'expired' | 'closed') {
    clearTimeout(this.#deadlineTimer);
    this.#key = undefined;
    this.#state = state;
  }

  close() {
    if (this.#busy) throw new MailPortTransferError('TRANSFER_BUSY');
    if (this.#state === 'open') this.#finish('closed');
  }

  #assertOpen() {
    if (Date.now() >= this.expiresAt * 1000) this.#expire();
    if (this.#state === 'used') throw new MailPortTransferError('TRANSFER_USED');
    if (this.#state === 'expired') throw new MailPortTransferError('TRANSFER_EXPIRED');
    if (this.#state === 'closed') throw new MailPortTransferError('TRANSFER_CLOSED');
  }

  async #decrypt(serialized: string, key: CryptoKey): Promise<Account[]> {
    let payload: ArrayBuffer | undefined;
    try {
      const envelope = packageSchema.parse(JSON.parse(serialized));
      if (envelope.requestId !== this.requestId) throw new MailPortTransferError('WRONG_RECIPIENT');
      const enc = decodeBase64(envelope.enc, length => length === 32);
      const ciphertext = decodeBase64(envelope.ciphertext, length => length > 16);
      const recipient = await suite.createRecipientContext({ recipientKey: key, enc, info: this.info });
      payload = await recipient.open(ciphertext);
      const accounts = parseAccounts(payloadSchema.parse(JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(payload),
      )).accounts);
      if (accounts.length === 0) throw new MailPortTransferError('INVALID_TRANSFER_PACKAGE');
      return accounts;
    } catch (error) {
      if (error instanceof MailPortTransferError) throw error;
      throw new MailPortTransferError('INVALID_TRANSFER_PACKAGE');
    } finally {
      if (payload) new Uint8Array(payload).fill(0);
    }
  }

  /**
   * The client must obtain explicit approval after comparing the package code
   * with the exporting vault on a trusted display or channel.
   */
  async importPackage(options: {
    serialized: string;
    verifiedCode: string;
    adapter: TransferAdapter;
    signal?: AbortSignal;
  }): Promise<{ completed: boolean; results: ImportResult[] }> {
    if (this.#busy) throw new MailPortTransferError('TRANSFER_BUSY');
    this.#assertOpen();
    const { serialized, verifiedCode, adapter, signal } = options;
    const hash = packageHash(serialized);
    if (formatCode(hash) !== verifiedCode) throw new MailPortTransferError('CODE_MISMATCH');
    if (this.#acceptedHash && !this.#acceptedHash.equals(hash)) {
      throw new MailPortTransferError('DIFFERENT_PACKAGE');
    }
    this.#busy = true;
    try {
      const accounts = await this.#decrypt(serialized, this.#key!);
      this.#assertOpen();
      this.#acceptedHash = hash;
      const results: ImportResult[] = [];
      for (const account of accounts) {
        const saved = this.#saved.get(account.id);
        if (saved) {
          results.push({ ...saved });
          continue;
        }
        if (signal?.aborted || Date.now() >= this.expiresAt * 1000 || this.#state !== 'open') {
          results.push({ accountId: account.id, status: 'cancelled' });
          continue;
        }
        const result = await configureAccount(account, current => adapter.upsertAccount(current));
        if (result.status === 'configured' || result.status === 'needs-sign-in') {
          this.#saved.set(result.accountId, result);
        }
        results.push({ ...result });
      }
      const completed = this.#saved.size === accounts.length;
      if (completed) this.#finish('used');
      return { completed, results };
    } finally {
      this.#busy = false;
    }
  }
}
