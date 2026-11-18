import assert from 'node:assert/strict';
import test from 'node:test';
import { importAccounts, listAccounts, type Account } from '../src/index.js';
import { fixture } from './fixtures.js';

test('summaries expose no server credentials', () => {
  const summaries = listAccounts([fixture(), fixture(2, true)]);
  assert.deepEqual(Object.keys(summaries[0]!), ['id', 'email', 'displayName', 'requiresSignIn']);
  assert.equal(summaries[1]!.requiresSignIn, true);
});

test('imports only selected accounts in approval order and marks OAuth pending', async () => {
  const accounts = [fixture(), fixture(2, true), fixture(3)];
  const received: Account[] = [];
  const results = await importAccounts({
    accounts, approvedAccountIds: [accounts[1]!.id, accounts[0]!.id],
    adapter: { async configureAccount(account) { received.push(account); } },
  });
  assert.deepEqual(received, [accounts[1], accounts[0]]);
  assert.deepEqual(results.map(r => r.status), ['needs-sign-in', 'configured']);
});

test('bad selection fails before any adapter receives credentials', async () => {
  const a = fixture();
  let called = false;
  for (const ids of [[], ['unknown'], [a.id, a.id], [a.id, 'unknown']]) {
    await assert.rejects(importAccounts({ accounts: [a], approvedAccountIds: ids, adapter: {
      async configureAccount() { called = true; },
    } }), { message: 'INVALID_SELECTION' });
  }
  assert.equal(called, false);
});

test('adapter failures are redacted and do not stop other accounts', async () => {
  const accounts = [fixture(), fixture(2)];
  const results = await importAccounts({ accounts, approvedAccountIds: accounts.map(a => a.id), adapter: {
    async configureAccount(a) { if (a.id === accounts[0]!.id) throw new Error('credential: fake-app-password-1'); },
  } });
  assert.deepEqual(results.map(r => r.status), ['failed', 'configured']);
  assert.equal(JSON.stringify(results).includes('password'), false);
});

test('cancellation prevents subsequent imports without claiming rollback', async () => {
  const accounts = [fixture(), fixture(2)];
  const controller = new AbortController();
  let count = 0;
  const results = await importAccounts({ accounts, approvedAccountIds: accounts.map(a => a.id), signal: controller.signal, adapter: {
    async configureAccount() { count++; controller.abort(); },
  } });
  assert.equal(count, 1);
  assert.deepEqual(results.map(r => r.status), ['configured', 'cancelled']);
});

test('selection and account data are snapshots even if caller or adapter mutates inputs', async () => {
  const accounts = [fixture(), fixture(2), fixture(3)];
  const ids = [accounts[0]!.id, accounts[1]!.id];
  const received: string[] = [];
  await importAccounts({ accounts, approvedAccountIds: ids, adapter: {
    async configureAccount(a) {
      received.push(a.id);
      ids.push(accounts[2]!.id);
      accounts[1]!.incoming.username = 'mutated';
      assert.notEqual(a.incoming.username, 'mutated');
      a.displayName = 'client mutation';
    },
  } });
  assert.equal(received.length, 2);
  assert.equal(accounts[0]!.displayName, 'Example 1');
});

test('OAuth status is determined before adapter code can change authentication', async () => {
  const a = fixture(1, true);
  const results = await importAccounts({ accounts: [a], approvedAccountIds: [a.id], adapter: {
    async configureAccount(account) {
      account.incoming.auth = { type: 'password', password: 'replacement' };
      account.outgoing.auth = { type: 'password', password: 'replacement' };
    },
  } });
  assert.equal(results[0]!.status, 'needs-sign-in');
});
