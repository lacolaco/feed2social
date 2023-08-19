import { Client as NotionClient, iteratePaginatedAPI } from '@notionhq/client';
import { Hono } from 'hono';
import { FeedItem } from './models';
import { assertType } from './notion-utils';
import { postMisskeyNote } from './social';

export type Env = {
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  MISSKEY_TOKEN: string;
};

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

async function fetchNewFeedItems(notion: NotionClient, notionDatabaseId: string): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  for await (const block of iteratePaginatedAPI(notion.databases.query, {
    database_id: notionDatabaseId,
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    filter: {
      and: [
        {
          timestamp: 'created_time',
          created_time: { this_week: {} },
        },
        {
          property: 'feed2social',
          checkbox: { equals: false },
        },
      ],
    },
  })) {
    if (block.object !== 'page' || !('properties' in block)) {
      continue;
    }
    const { properties } = block;

    assertType('title', properties.title);
    assertType('url', properties.url);

    const title = properties.title.title.map((t) => t.plain_text).join('') ?? '';
    const url = properties.url.url ?? '';

    if (title === '' || url === '') {
      continue;
    }

    items.push({ notionBlockId: block.id, title, url });
  }

  return items;
}

async function postFeedItemsToSocial(items: FeedItem[], env: Env) {
  for (const item of items) {
    const message = `🔖 "${item.title}" ${item.url} #laco_feed`;

    // misskey
    await postMisskeyNote(message, env.MISSKEY_TOKEN);
    // twitter
    // TODO
    // bluesky
    // TODO

    console.log(`posted: ${message}`);
  }
}

async function markFeedItemsAsProcessed(notion: NotionClient, newItems: FeedItem[]) {
  for (const item of newItems) {
    await notion.pages.update({
      page_id: item.notionBlockId,
      properties: {
        feed2social: { checkbox: true },
      },
    });
  }
}

const app = new Hono<{ Bindings: Env }>();

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
