import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  ImportRequestSession,
  sealVault,
  transferPackageCode,
  unlockVault,
} from "../packages/sdk/dist/index.js";
const vector = JSON.parse(
  await readFile(new URL("../docs/vectors/v1.json", import.meta.url), "utf8"),
);
function rust(mode, input) {
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "-p",
      "mailport-core",
      "--example",
      "compatibility",
      "--",
      ...mode,
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      input,
      env: { ...process.env, CARGO_INCREMENTAL: "0", CARGO_BUILD_JOBS: "2" },
      timeout: 180000,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Rust compatibility command failed: ${result.stderr}`);
  return result.stdout.trim();
}
const rustPackage = rust([], undefined);
assert.deepEqual(
  await unlockVault(rustPackage, vector.password),
  vector.accounts,
);
const accounts = Array.from({ length: 5 }, (_, i) => ({
  ...structuredClone(vector.accounts[0]),
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  email: `sample${i + 1}@example.com`,
  displayName: `Élodie ${i + 1} 🌊`,
}));
const selected = [accounts[1], accounts[4]];
const envelope = await sealVault(selected, vector.password);
rust(
  ["verify"],
  JSON.stringify({ envelope, password: vector.password, accounts: selected }),
);
console.log(
  "Bidirectional Rust/Node format checks passed, including a two-of-five account package.",
);

for (const server of ["incoming", "outgoing"]) {
  selected[0][server].auth = { type: "password", password: "public-test-password" };
}
selected[1].incoming.auth = { type: "oauth", providerId: "example-provider" };
const receiver = await ImportRequestSession.create("Compatibility Client");
const transferInput = JSON.stringify({
  requestFile: receiver.requestFile,
  accounts,
  ids: selected.map(({ id }) => id),
});
const transfer = JSON.parse(rust(["seal-transfer"], transferInput));
const alternate = JSON.parse(rust(["seal-transfer"], transferInput));
assert.equal(transfer.verificationCode, receiver.verificationCode);
assert.equal(transfer.packageCode, transferPackageCode(transfer.package));
assert.notEqual(transfer.package, alternate.package);
assert.ok(!transfer.package.includes(selected[0].email));
const calls = [];
let shouldFail = true;
const options = {
  serialized: transfer.package,
  verifiedCode: transfer.packageCode,
  adapter: {
    async upsertAccount(account) {
      calls.push(account);
      if (shouldFail && account.id === selected[1].id) throw new Error("Synthetic failure");
    },
  },
};
const wrongReceiver = await ImportRequestSession.create("Other Client");
await assert.rejects(wrongReceiver.importPackage(options), { code: "WRONG_RECIPIENT" });
const forged = JSON.stringify({
  ...JSON.parse(transfer.package),
  requestId: JSON.parse(wrongReceiver.requestFile).requestId,
});
await assert.rejects(
  wrongReceiver.importPackage({ ...options, serialized: forged, verifiedCode: transferPackageCode(forged) }),
  { code: "INVALID_TRANSFER_PACKAGE" },
);
wrongReceiver.close();
const cancelledReceiver = await ImportRequestSession.create("Cancelled Client");
const cancelledTransfer = JSON.parse(rust(["seal-transfer"], JSON.stringify({
  requestFile: cancelledReceiver.requestFile,
  accounts,
  ids: selected.map(({ id }) => id),
})));
const cancelledCalls = [];
const controller = new AbortController();
controller.abort();
const cancelledOptions = {
  serialized: cancelledTransfer.package,
  verifiedCode: cancelledTransfer.packageCode,
  adapter: { async upsertAccount(account) { cancelledCalls.push(account.id); } },
};
assert.deepEqual(await cancelledReceiver.importPackage({ ...cancelledOptions, signal: controller.signal }), {
  completed: false,
  results: selected.map(({ id }) => ({ accountId: id, status: "cancelled" })),
});
assert.equal(cancelledCalls.length, 0);
assert.equal((await cancelledReceiver.importPackage(cancelledOptions)).completed, true);
assert.deepEqual(cancelledCalls, selected.map(({ id }) => id));
await assert.rejects(receiver.importPackage({ ...options, verifiedCode: "UNKNOWN" }), { code: "CODE_MISMATCH" });
assert.equal(calls.length, 0);

const first = receiver.importPackage(options);
await assert.rejects(receiver.importPackage(options), { code: "TRANSFER_BUSY" });
assert.deepEqual(await first, {
  completed: false,
  results: [
    { accountId: selected[0].id, status: "configured" },
    { accountId: selected[1].id, status: "failed" },
  ],
});
assert.deepEqual(calls, selected);
await assert.rejects(
  receiver.importPackage({ ...options, serialized: alternate.package, verifiedCode: alternate.packageCode }),
  { code: "DIFFERENT_PACKAGE" },
);
shouldFail = false;
assert.deepEqual(await receiver.importPackage(options), {
  completed: true,
  results: [
    { accountId: selected[0].id, status: "configured" },
    { accountId: selected[1].id, status: "needs-sign-in" },
  ],
});
assert.deepEqual(calls, [...selected, selected[1]]);
await assert.rejects(receiver.importPackage(options), { code: "TRANSFER_USED" });
assert.equal(calls.length, 3);
const expiring = await ImportRequestSession.create("Expiring Client");
const originalNow = Date.now;
try {
  Date.now = () => expiring.expiresAt * 1000;
  await assert.rejects(expiring.importPackage(options), { code: "TRANSFER_EXPIRED" });
} finally {
  Date.now = originalNow;
  expiring.close();
}
console.log("Rust-to-Node passwordless transfer passed, including wrong recipient, concurrent import, retry, expiry and replay checks.");
