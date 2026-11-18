import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sealVault, unlockVault, listAccounts, importAccounts } from '../src/index.js';

// Synthetic credentials only. Production passwords must come from a secure UI.
const accounts = Array.from({ length: 5 }, (_, i) => ({
  id: randomUUID(), email: `demo${i + 1}@example.com`, displayName: `Demo ${i + 1}`,
  incoming: { host: 'imap.example.com', port: 993, security: 'tls', username: `demo${i + 1}`, auth: { type: 'password', password: 'synthetic-demo-secret' } },
  outgoing: { host: 'smtp.example.com', port: 587, security: 'starttls', username: `demo${i + 1}`, auth: { type: 'password', password: 'synthetic-demo-secret' } },
}));
const encrypted = await sealVault(accounts, 'synthetic-demo-master-password');
const unlocked = await unlockVault(encrypted, 'synthetic-demo-master-password');
const summaries = listAccounts(unlocked);
// A real host displays summaries and obtains approval before forming this list.
const approvedAccountIds = summaries.map(a => a.id);

// Two in-memory storage shapes exercise the adapter contract. These are NOT
// independently implemented email clients or proof of network connectivity.
const firstStore = new Map<string, unknown>();
const secondStore: unknown[] = [];
for (const adapter of [
  { async configureAccount(a: typeof unlocked[number]) { firstStore.set(a.id, structuredClone(a)); } },
  { async configureAccount(a: typeof unlocked[number]) { secondStore.push({ identity: a.email, imap: a.incoming, smtp: a.outgoing }); } },
]) {
  const results = await importAccounts({ accounts: unlocked, approvedAccountIds, adapter });
  assert.equal(results.filter(r => r.status === 'configured').length, 5);
}
assert.equal(firstStore.size, 5);
assert.equal(secondStore.length, 5);
console.log('Five synthetic accounts encrypted, unlocked and configured through two in-memory adapters.');
