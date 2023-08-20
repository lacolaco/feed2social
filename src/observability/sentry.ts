import { Toucan, Transaction } from 'toucan-js';

export function initSentry(dsn: string, context: ExecutionContext) {
  const sentry = new Toucan({
    dsn,
    context,
    integrations: [new Transaction()],
  });
  return sentry;
}
