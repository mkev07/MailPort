import { execFileSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const target = process.argv[2];
const expected = '0635d327398c8d97255660ae7b0011bf1e3fe4df';
if (!target) throw new Error('Provide a clean Mailspring checkout path.');
const checkout = realpathSync(target);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
if (head !== expected) throw new Error(`Expected Mailspring commit ${expected}; found ${head}.`);
const status = execFileSync('git', ['status', '--porcelain'], { cwd: checkout, encoding: 'utf8' });
if (status.trim()) throw new Error('The Mailspring checkout must be clean.');
const patch = readFileSync(join(here, 'preview.patch'), 'utf8').replace(/\r\n/g, '\n');
const applyOptions = { cwd: checkout, input: patch, stdio: ['pipe', 'inherit', 'inherit'] };
const bundle = join(checkout, 'app/internal_packages/onboarding/lib/mailport-sdk.cjs');
if (existsSync(bundle)) throw new Error('The preview bundle already exists in the checkout.');
execFileSync('git', ['apply', '--check', '-'], applyOptions);
const temp = mkdtempSync(join(tmpdir(), 'mailport-preview-'));
try {
  const stagedBundle = join(temp, 'mailport-sdk.cjs');
  await build({
    absWorkingDir: root,
    entryPoints: ['packages/sdk/src/transfer.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: stagedBundle,
  });
  execFileSync('git', ['apply', '-'], applyOptions);
  copyFileSync(stagedBundle, bundle, constants.COPYFILE_EXCL);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log('Prepared the local Mailspring preview. See integrations/mailspring/README.md.');
