import { MailPortError, parseAccounts, type Account } from './schema.js';

export interface AccountSummary {
  id: string;
  email: string;
  displayName: string;
  requiresSignIn: boolean;
}
export interface ImportAdapter {
  /** Configure locally. Resolve only after the client has saved the account.
   * OAuth accounts must remain pending until the client's own sign-in succeeds.
   * Credentials must not be logged. Throws are converted to a generic failure.
   */
  configureAccount(account: Account): Promise<void>;
}
export interface ImportResult {
  accountId: string;
  status: 'configured' | 'needs-sign-in' | 'failed' | 'cancelled';
}
const requiresSignIn = (a: Account) => a.incoming.auth.type === 'oauth' || a.outgoing.auth.type === 'oauth';

export async function configureAccount(
  account: Account,
  save: (account: Account) => Promise<void>,
): Promise<ImportResult> {
  const accountId = account.id;
  const status = requiresSignIn(account) ? 'needs-sign-in' : 'configured';
  try {
    await save(account);
    return { accountId, status };
  } catch {
    return { accountId, status: 'failed' };
  }
}

/** Safe fields for the host's selection UI. Account addresses remain private data. */
export function listAccounts(accounts: unknown): AccountSummary[] {
  return parseAccounts(accounts).map(a => ({
    id: a.id, email: a.email, displayName: a.displayName, requiresSignIn: requiresSignIn(a),
  }));
}

/** The host must obtain user approval before calling this function.
 * Account selection is a scope filter, not proof of human consent or an IPC boundary.
 */
export async function importAccounts(options: {
  accounts: unknown;
  approvedAccountIds: readonly string[];
  adapter: ImportAdapter;
  signal?: AbortSignal;
}): Promise<ImportResult[]> {
  const accounts = parseAccounts(options.accounts);
  if (!Array.isArray(options.approvedAccountIds)) throw new MailPortError('INVALID_SELECTION');
  const ids = [...options.approvedAccountIds];
  if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some(id => !accounts.some(a => a.id === id))) {
    throw new MailPortError('INVALID_SELECTION');
  }
  const byId = new Map(accounts.map(a => [a.id, a]));
  const results: ImportResult[] = [];
  for (const id of ids) {
    const account = byId.get(id)!;
    if (options.signal?.aborted) {
      results.push({ accountId: id, status: 'cancelled' });
      continue;
    }
    results.push(await configureAccount(account, account => options.adapter.configureAccount(account)));
  }
  return results;
}
