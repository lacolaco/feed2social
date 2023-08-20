import { Client as NotionClient } from '@notionhq/client';
import { Hono } from 'hono';
import { FeedItem, SocialPostSender } from './models';
import { initSentry } from './observability/sentry';
import { fetchNewFeedItems, markFeedItemAsProcessed } from './repository';
import { BlueskyPostSender } from './social/bluesky';
import { MisskeyPostSender } from './social/misskey';
import { TwitterPostSender } from './social/twitter';

export type Env = {
  SENTRY_DSN: string;
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

async function execute(env: Env) {
  const notion = new NotionClient({ auth: env.NOTION_TOKEN });
  const postSenders: SocialPostSender[] = [
    new MisskeyPostSender(env.MISSKEY_TOKEN),
    new BlueskyPostSender(env.BSKY_ID, env.BSKY_PASSWORD),
    new TwitterPostSender(env.TWITTER_API_KEY, env.TWITTER_API_SECRET, env.TWITTER_ACCESS_TOKEN, env.TWITTER_ACCESS_SECRET),
  ];

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

  try {
    for (const item of newItems) {
      const results = await Promise.allSettled(postSenders.map((sender) => sender.sendPost(item)));
      // always mark as processed even if failed to post to prevent infinite retry
      await markFeedItemAsProcessed(notion, item);
      for (const result of results) {
        if (result.status === 'rejected') {
          throw result.reason;
        }
      }
      console.log(`posted: ${item.title}`);
    }
  } catch (e) {
    throw new Error(`failed to post feed items to social: ${e}`);
  }
}

const app = new Hono<{ Bindings: Env }>();

if (isDevelopment) {
  // for debugging
  app.get('/_/execute', async (c) => {
    const url = new URL(c.req.url);
    console.log(`triggered by fetch at ${url.toString()}`);
    await execute(c.env);
    return c.text('ok');
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const sentry = initSentry(env.SENTRY_DSN, ctx);
    sentry.startSession();
    try {
      await execute(env);
    } catch (e) {
      console.error(e);
      sentry.captureException(e);
    } finally {
      sentry.endSession();
    }
  },
  fetch: app.fetch,
};
