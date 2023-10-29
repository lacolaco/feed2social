import { Client as NotionClient } from '@notionhq/client';
import { Hono } from 'hono';
import { CreatePostReq, FeedItem, SocialPostSender } from './models';
import { Sentry, initSentry } from './observability/sentry';
import { fetchNewFeedItems, markFeedItemAsProcessed } from './repository';
import { BlueskyPostSender } from './social/bluesky';
import { MisskeyPostSender } from './social/misskey';
import { TwitterPostSender } from './social/twitter';

export type Env = {
  SENTRY_DSN: string;
  SENTRY_RELEASE: string;
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  MISSKEY_TOKEN: string;
  BSKY_ID: string;
  BSKY_PASSWORD: string;
  TWITTER_API_KEY: string;
  TWITTER_API_SECRET: string;
  TWITTER_ACCESS_TOKEN: string;
  TWITTER_ACCESS_SECRET: string;
  xenon: Fetcher;
};

const isDevelopment = process.env.NODE_ENV === 'development';

async function createPost(req: CreatePostReq, env: Env) {
  const res = await env.xenon.fetch('https://feed2social.lacolaco.workers.dev/posts/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`failed to create post: ${res.status} ${await res.text()}`);
  }
}

async function execute(env: Env, sentry: Sentry) {
  const notion = new NotionClient({ auth: env.NOTION_TOKEN });
  const postSenders: SocialPostSender[] = [
    new MisskeyPostSender(env.MISSKEY_TOKEN),
    new BlueskyPostSender(env.BSKY_ID, env.BSKY_PASSWORD),
    new TwitterPostSender(env.TWITTER_API_KEY, env.TWITTER_API_SECRET, env.TWITTER_ACCESS_TOKEN, env.TWITTER_ACCESS_SECRET),
  ];

  sentry.addBreadcrumb({ level: 'log', message: 'fetching new feed items' });

  let newItems: FeedItem[] = [];
  try {
    newItems = await fetchNewFeedItems(notion, env.NOTION_DATABASE_ID);
    console.log(`new items: ${newItems.length}`);
  } catch (e) {
    throw new Error(`failed to fetch new feed items: ${e}`);
  }

  if (isDevelopment) {
    console.log(JSON.stringify(newItems, null, 2));
    console.log('skipped posting to social because of development mode');
    return;
  }

  sentry.addBreadcrumb({ level: 'log', message: 'posting feed items to social' });

  const req: CreatePostReq = { data: [] };

  for (const item of newItems) {
    req.data.push(...postSenders.map((sender) => sender.buildPost(item)));
    await markFeedItemAsProcessed(notion, item);
  }

  try {
    sentry.addBreadcrumb({ level: 'log', message: 'posting feed item to social' });
    await createPost(req, env);
  } catch (e) {
    throw new Error(`failed to post feed items to social: ${e}`);
  }

  sentry.addBreadcrumb({ level: 'log', message: 'done' });
}

const app = new Hono<{ Bindings: Env }>();

if (isDevelopment) {
  // for debugging
  app.get('/_/execute', async (c) => {
    const sentry = initSentry(c.env.SENTRY_DSN, c.env.SENTRY_RELEASE, c.executionCtx);
    const url = new URL(c.req.url);
    console.log(`triggered by fetch at ${url.toString()}`);
    try {
      await execute(c.env, sentry);
      return c.text('ok');
    } catch (e) {
      console.error(e);
      sentry.captureException(e);
      return c.text('error', 500);
    } finally {
      sentry.captureMessage('done');
    }
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const sentry = initSentry(env.SENTRY_DSN, env.SENTRY_RELEASE, ctx);
    sentry.setContext('event', event);
    const checkInId = sentry.captureCheckIn({ monitorSlug: 'scheduled-feed2social', status: 'in_progress' });
    ctx.waitUntil(
      execute(env, sentry)
        .then(() => {
          sentry.captureCheckIn({ checkInId, monitorSlug: 'scheduled-feed2social', status: 'ok' });
        })
        .catch((e) => {
          console.error(e);
          sentry.captureException(e);
          sentry.captureCheckIn({ checkInId, monitorSlug: 'scheduled-feed2social', status: 'error' });
          throw e;
        }),
    );
  },
  fetch: app.fetch,
};
