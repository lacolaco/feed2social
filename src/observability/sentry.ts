import { Toucan, Transaction } from 'toucan-js';

export type Sentry = Toucan;

export function initSentry(dsn: string, release: string, context: ExecutionContext) {
  const sentry = new Toucan({
    dsn,
    context,
    environment: process.env.NODE_ENV ?? 'production',
    release,
    integrations: [new Transaction()],
  });
  return sentry;
}
