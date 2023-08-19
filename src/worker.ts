import { Client as NotionClient } from '@notionhq/client';
import { Hono } from 'hono';
import { FeedItem } from './models';
import { fetchNewFeedItems, markFeedItemsAsProcessed } from './repository';
import { createBlueskyPost, createMisskeyNote, createTwitterPost } from './social';

export type Env = {
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

  let newItems: FeedItem[] = [];
  try {
    newItems = await fetchNewFeedItems(notion, env.NOTION_DATABASE_ID);
    console.log(`new items: ${newItems.length}`);
  } catch (e) {
    console.error(e);
    throw new Error(`failed to fetch new feed items: ${e}`);
  }

  if (newItems.length === 0) {
    return;
  }

  if (isDevelopment) {
    console.log(JSON.stringify(newItems, null, 2));

    console.log('skipped posting to social because of development mode');
    return;
  }

  try {
    await postFeedItemsToSocial(newItems, env);
  } catch (e) {
    console.error(e);
    throw new Error(`failed to post feed items to social: ${e}`);
  }

  try {
    await markFeedItemsAsProcessed(notion, newItems);
  } catch (e) {
    console.error(e);
    throw new Error(`failed to mark feed items as processed: ${e}`);
  }
}

async function postFeedItemsToSocial(items: FeedItem[], env: Env) {
  for (const item of items) {
    await Promise.allSettled([
      createMisskeyNote(item, env.MISSKEY_TOKEN),
      createBlueskyPost(item, { identifier: env.BSKY_ID, password: env.BSKY_PASSWORD }),
      createTwitterPost(item, {
        consumerKey: env.TWITTER_API_KEY,
        consumerSecret: env.TWITTER_API_SECRET,
        accessToken: env.TWITTER_ACCESS_TOKEN,
        accessSecret: env.TWITTER_ACCESS_SECRET,
      }),
    ]);

    console.log(`posted: ${item.title}`);
  }
}

const app = new Hono<{ Bindings: Env }>();

// for debugging
app.get('/_/execute', async (c) => {
  const url = new URL(c.req.url);
  console.log(`triggered by fetch at ${url.toString()}`);
  await execute(c.env);
  return c.text('ok');
});

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`triggered by cron at ${event.cron}`);
    await execute(env);
  },
  fetch: app.fetch,
};
