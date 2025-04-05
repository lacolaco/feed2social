import { ExecutionContext } from 'hono';
import { Toucan } from 'toucan-js';

export type Sentry = Toucan;

export function initSentry(dsn: string, release: string, context: ExecutionContext) {
  const sentry = new Toucan({
    dsn,
    context,
    environment: process.env.NODE_ENV ?? 'production',
    release,
  });
  return sentry;
}
