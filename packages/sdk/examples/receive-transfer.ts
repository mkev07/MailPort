import { constants } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ImportRequestSession, MailPortTransferError, transferPackageCode } from '../src/index.js';

async function readPackage(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new Error('Expected a regular file.');
    const limit = 4 * 1024 * 1024;
    const parts: Buffer[] = [];
    let size = 0;
    for await (const part of file.createReadStream({ autoClose: false })) {
      size += part.length;
      if (size > limit) throw new Error('The transfer exceeds 4 MiB.');
      parts.push(part);
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(parts));
  } finally {
    await file.close();
  }
}

const requestPath = process.argv[2] || 'MailPort-demo.mailportrequest';
const session = await ImportRequestSession.create('MailPort Demo Receiver');
const terminal = createInterface({ input: stdin, output: stdout });
const signal = AbortSignal.timeout(Math.max(0, session.expiresAt * 1000 - Date.now()));
try {
  await writeFile(requestPath, session.requestFile, { flag: 'wx', mode: 0o600 });
  console.log('Demo only. Transfer synthetic accounts from MailPort Vault.');
  console.log('Import request:', requestPath);
  console.log('Request code:', session.verificationCode);
  console.log('Leave this process open. The request expires in 15 minutes.');
  while (Date.now() < session.expiresAt * 1000) {
    const path = await terminal.question('Path to the saved .mailport file (blank to exit): ', { signal });
    if (!path.trim()) break;
    try {
      const serialized = await readPackage(path.trim());
      const code = transferPackageCode(serialized);
      console.log('Transfer code:', code);
      const confirmed = await terminal.question('Does this match the code shown by MailPort Vault? [y/N] ', { signal });
      if (confirmed.trim().toLowerCase() !== 'y') continue;
      const result = await session.importPackage({
        serialized,
        verifiedCode: code,
        adapter: { async upsertAccount() { /* Demo: discard account data. */ } },
      });
      console.log(result.results);
      if (result.completed) {
        console.log('Transfer consumed. No account data was persisted by this demo.');
        break;
      }
    } catch (error) {
      console.error(error instanceof MailPortTransferError ? error.code : 'Could not read the selected transfer.');
    }
  }
} catch (error) {
  if (signal.aborted) console.log('The import request expired. Create a new request to try again.');
  else if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
    console.error('That request file already exists. Choose a different output filename.');
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  session.close();
  terminal.close();
}
