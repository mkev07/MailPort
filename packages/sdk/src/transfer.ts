import { createHash } from 'node:crypto';
import { formatTransferCode, packageBytes } from './transfer-session.js';

export { ImportRequestSession, MailPortTransferError, type TransferAdapter } from './transfer-session.js';

/** Display this to compare against the code shown by the exporting vault. */
export function transferPackageCode(serialized: string): string {
  const hash = createHash('sha256').update(packageBytes(serialized)).digest();
  return formatTransferCode(hash);
}
