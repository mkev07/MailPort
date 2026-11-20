import assert from 'node:assert/strict';
import test from 'node:test';
import { ImportRequestSession } from '../src/transfer.js';

test('request sessions work when the host exposes browser-style global timers', async () => {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (() => 1) as unknown as typeof setTimeout;
  try {
    const session = await ImportRequestSession.create('Mailspring');
    assert.match(session.verificationCode, /^(?:[A-F0-9]{4}-){3}[A-F0-9]{4}$/);
    session.close();
  } finally {
    globalThis.setTimeout = original;
  }
});
