import assert from 'node:assert/strict';
import test from 'node:test';
import { sealVault, unlockVault, parseAccounts } from '../src/index.js';
import { fixture, masterPassword } from './fixtures.js';

const accounts = [fixture(), fixture(2, true)];

test('vault roundtrip preserves independent SMTP and IMAP credentials', async () => {
  const original = fixture();
  original.outgoing.auth = { type: 'password', password: 'different-smtp-password' };
  original.displayName = 'Élodie 🌊';
  assert.deepEqual(await unlockVault(await sealVault([original], masterPassword), masterPassword), [original]);
});

test('encryption hides metadata and credentials and uses fresh salt and nonce', async () => {
  const first = await sealVault(accounts, masterPassword);
  const second = await sealVault(accounts, masterPassword);
  for (const secret of ['account1@example.com', 'fake-app-password', 'imap.example.com', 'Example 1']) {
    assert.equal(first.includes(secret), false);
  }
  assert.notEqual(JSON.parse(first).salt, JSON.parse(second).salt);
  assert.notEqual(JSON.parse(first).nonce, JSON.parse(second).nonce);
  assert.deepEqual(await unlockVault(first, masterPassword), accounts);
});

test('incorrect password and authenticated content tampering fail safely', async () => {
  const sealed = await sealVault(accounts, masterPassword);
  await assert.rejects(unlockVault(sealed, 'incorrect-long-password'), { message: 'UNLOCK_FAILED' });
  for (const field of ['salt', 'nonce', 'ciphertext', 'tag']) {
    const envelope = JSON.parse(sealed);
    const bytes = Buffer.from(envelope[field], 'base64');
    bytes[0] = bytes[0]! ^ 1;
    envelope[field] = bytes.toString('base64');
    await assert.rejects(unlockVault(JSON.stringify(envelope), masterPassword), { message: 'UNLOCK_FAILED' });
  }
});

test('rejects malformed, oversized and unsupported envelopes before decryption', async () => {
  for (const input of ['{', '{}', 'x'.repeat(4 * 1024 * 1024 + 1)]) {
    await assert.rejects(unlockVault(input, masterPassword), { message: 'INVALID_VAULT' });
  }
  const sealed = JSON.parse(await sealVault(accounts, masterPassword));
  for (const changes of [{ version: 2 }, { suite: 'weak-suite' }, { nonce: 'AAAA' }, { N: 2 ** 30 }, { tag: 'invalid' }]) {
    await assert.rejects(unlockVault(JSON.stringify({ ...sealed, ...changes }), masterPassword), { message: 'INVALID_VAULT' });
  }
});

test('rejects weak or excessive passwords', async () => {
  for (const password of ['', 'short', 'a'.repeat(1025)]) {
    await assert.rejects(sealVault(accounts, password), { message: 'INVALID_PASSWORD' });
  }
});

test('schema rejects plaintext transport, injected OAuth tokens and duplicate IDs', () => {
  const insecure = fixture();
  const withToken = fixture(2, true);
  for (const value of [
    [{ ...insecure, incoming: { ...insecure.incoming, security: 'none' } }],
    [{ ...withToken, incoming: { ...withToken.incoming, auth: { ...withToken.incoming.auth, refreshToken: 'secret' } } }],
    [insecure, insecure],
    [{ ...insecure, outgoing: { ...insecure.outgoing, port: 0 } }],
    Array.from({ length: 101 }, (_, i) => fixture(i + 1)),
  ]) {
    assert.throws(() => parseAccounts(value), { message: 'INVALID_ACCOUNTS' });
  }
});

test('empty vault can be stored and unlocked', async () => {
  assert.deepEqual(await unlockVault(await sealVault([], masterPassword), masterPassword), []);
});

test('public v1 known-answer vector decrypts exactly', async () => {
  const { readFile } = await import('node:fs/promises');
  const vector = JSON.parse(await readFile(new URL('../../../docs/vectors/v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(await unlockVault(JSON.stringify(vector.envelope), vector.password), vector.accounts);
});

test('noncanonical base64 encodings are rejected', async () => {
  const envelope = JSON.parse(await sealVault(accounts, masterPassword));
  // A 16-byte salt has two padding characters. Change only the unused pad bits.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const position = envelope.salt.length - 3;
  const original = alphabet.indexOf(envelope.salt[position]);
  envelope.salt = envelope.salt.slice(0, position) + alphabet[original + 1] + '==';
  await assert.rejects(unlockVault(JSON.stringify(envelope), masterPassword), { message: 'INVALID_VAULT' });
});
