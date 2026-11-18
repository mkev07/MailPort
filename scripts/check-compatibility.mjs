import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { sealVault, unlockVault } from "../packages/sdk/dist/index.js";
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
