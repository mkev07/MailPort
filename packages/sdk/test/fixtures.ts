import type { Account } from '../src/index.js';

export const masterPassword = 'example-only-long-passphrase';
export function fixture(index = 1, oauth = false): Account {
  const auth = oauth
    ? { type: 'oauth' as const, providerId: 'example-provider' }
    : { type: 'password' as const, password: `fake-app-password-${index}` };
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    email: `account${index}@example.com`, displayName: `Example ${index}`,
    incoming: { host: 'imap.example.com', port: 993, security: 'tls', username: `account${index}@example.com`, auth: { ...auth } },
    outgoing: { host: 'smtp.example.com', port: 587, security: 'starttls', username: `account${index}@example.com`, auth: { ...auth } },
  };
}
