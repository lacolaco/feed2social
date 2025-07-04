import { Client as NotionClient } from '@notionhq/client';
import { ExecutionContext, Hono } from 'hono';
import { createPostData } from './create-post';
import { FeedItem, SocialNetworkAdapter } from './models';
import { initSentry, Sentry } from './observability/sentry';
import { fetchNewFeedItems, saveFeedItemStatus } from './repository';
import { BlueskyAdapter } from './social/bluesky';
import { MisskeyAdapter } from './social/misskey';
import { TwitterAdapter } from './social/twitter';

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
};

const isDevelopment = process.env.NODE_ENV === 'development';

async function execute(env: Env, sentry: Sentry, dryRun = false) {
  // Bind fetch to globalThis to avoid Illegal Invocation errors.
  // // This is necessary because of Cloudflare Workers' isolation of the global scope.
  // https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors
  // https://zenn.dev/sui_water/articles/3329c4b318d934
  const boundFetch = globalThis.fetch.bind(globalThis);
  const notion = new NotionClient({ auth: env.NOTION_TOKEN, fetch: boundFetch });
  const allNetworkAdapters: SocialNetworkAdapter[] = [
    new MisskeyAdapter(env.MISSKEY_TOKEN),
    new BlueskyAdapter(env.BSKY_ID, env.BSKY_PASSWORD),
    new TwitterAdapter(env.TWITTER_API_KEY, env.TWITTER_API_SECRET, env.TWITTER_ACCESS_TOKEN, env.TWITTER_ACCESS_SECRET),
  ];
  console.log('release:', env.SENTRY_RELEASE);
  if (dryRun) {
    console.log('[DRY RUN] mode enabled - no actual posting or status updates will occur');
  }
  sentry.addBreadcrumb({ level: 'log', message: 'fetching new feed items' });

  let incomingFeedItems: FeedItem[] = [];
  try {
    incomingFeedItems = await fetchNewFeedItems(notion, env.NOTION_DATABASE_ID);
    console.log(`new items: ${incomingFeedItems.length}`);
  } catch (e) {
    throw new Error(`failed to fetch new feed items: ${e}`, { cause: e });
  }

  sentry.addBreadcrumb({ level: 'log', message: 'posting feed items to social' });

  try {
    for (const feedItem of incomingFeedItems) {
      sentry.addBreadcrumb({ level: 'log', message: 'posting feed item to social', data: feedItem });
      console.log(`posting: ${JSON.stringify(feedItem, null, 2)}`);

      const networks = allNetworkAdapters.filter((network) => !feedItem.completedNetworkKeys.has(network.getNetworkKey()));
      console.log(`posted to ${networks.map((network) => network.getNetworkKey()).join(', ')}`);

      const post = await createPostData(feedItem);
      console.log(`post data: ${JSON.stringify(post, null, 2)}`);

      const results = await Promise.allSettled(
        networks.map(async (network) => {
          if (dryRun) {
            console.log(`[DRY RUN] would post to ${network.getNetworkKey()}: ${JSON.stringify(post, null, 2)}`);
          } else {
            await network.createPost(post);
          }
          return { network: network.getNetworkKey(), status: 'ok' };
        }),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error(`failed to post: ${result.reason}`);
          sentry.captureException(result.reason);
          continue;
        }
        const { network } = result.value;
        feedItem.completedNetworkKeys.add(network);
      }
      if (dryRun) {
        console.log(`[DRY RUN] would save feed item status for: ${feedItem.notionPageId}`);
      } else {
        await saveFeedItemStatus(notion, feedItem);
      }
    }
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
      await execute(c.env, sentry, true);
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
    sentry.setContext('event', { cron: event.cron, scheduledTime: event.scheduledTime });
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
