import { z } from 'zod';

export class MailPortError extends Error {
  constructor(public readonly code: 'INVALID_ACCOUNTS' | 'INVALID_VAULT' | 'UNLOCK_FAILED' | 'INVALID_PASSWORD' | 'INVALID_SELECTION') {
    super(code);
    this.name = 'MailPortError';
  }
}

const passwordAuth = z.strictObject({
  type: z.literal('password'),
  password: z.string().min(1).max(4096),
});
const oauthAuth = z.strictObject({
  type: z.literal('oauth'),
  providerId: z.string().min(1).max(128),
});
const server = z.strictObject({
  host: z.string().min(1).max(253).regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls']),
  username: z.string().min(1).max(320),
  auth: z.discriminatedUnion('type', [passwordAuth, oauthAuth]),
});
export const AccountSchema = z.strictObject({
  id: z.string().uuid(),
  email: z.email().max(320),
  displayName: z.string().max(256),
  incoming: server,
  outgoing: server,
});
export const AccountsSchema = z.array(AccountSchema).max(100).superRefine((accounts, ctx) => {
  if (new Set(accounts.map(a => a.id)).size !== accounts.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate account IDs' });
  }
});
export type Account = z.infer<typeof AccountSchema>;

export function parseAccounts(value: unknown): Account[] {
  const parsed = AccountsSchema.safeParse(value);
  if (!parsed.success) throw new MailPortError('INVALID_ACCOUNTS');
  return parsed.data;
}
