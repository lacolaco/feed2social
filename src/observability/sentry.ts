import { Toucan } from 'toucan-js';

export function initSentry(dsn: string, context: ExecutionContext) {
  const sentry = new Toucan({
    dsn,
    context,
  });
  return sentry;
}
