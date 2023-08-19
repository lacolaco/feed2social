import { Client, iteratePaginatedAPI } from '@notionhq/client';
import { Hono } from 'hono';
import { Feed } from 'feed';

export type Env = {
  DB: D1Database;
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
};

export type FeedItemRow = {
  id: string;
  notion_block_id: string;
  title: string;
  url: string;
  created_at: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/rss', async (c) => {
  const feed = await buildFeed(c.env.DB);
  return c.text(feed, {
    headers: { 'Content-Type': 'application/rss+xml' },
  });
});

app.get('/_/sync', async (c) => {
  const url = new URL(c.req.url);
  console.log(`triggered by fetch at ${url.toString()}`);
  await syncDatabase(c.env.NOTION_TOKEN, c.env.NOTION_DATABASE_ID, c.env.DB);
  return c.text('ok');
});

async function buildFeed(db: D1Database) {
  const feed = new Feed({
    id: 'https://feed.lacolaco.dev/',
    link: 'https://feed.lacolaco.dev/rss',
    title: 'feed.lacolaco.dev',
    copyright: 'All rights reserved 2023, lacolaco',
  });

  const items = await db.prepare('SELECT * FROM FeedItems ORDER BY created_at DESC LIMIT 100').all<FeedItemRow>();

  console.log(JSON.stringify(items.results));

  for (const item of items.results ?? []) {
    feed.addItem({
      title: item.title,
      link: item.url,
      date: new Date(item.created_at),
    });
  }

  return feed.rss2();
}

async function syncDatabase(notionToken: string, notionDatabaseId: string, db: D1Database) {
  const notion = new Client({ auth: notionToken });
  const newItems = [];
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
          property: 'notion2rss',
          checkbox: { equals: false },
        },
      ],
    },
  })) {
    if (block.object !== 'page' || !('properties' in block)) {
      continue;
    }
    newItems.push(block);
  }
  console.log(`new items: ${newItems.length}`);

  for (const item of newItems) {
    const { properties, created_time } = item;

    assertType('title', properties.title);
    assertType('url', properties.url);

    const title = properties.title.title.map((t) => t.plain_text).join('');
    const url = properties.url.url;

    // save items to database
    await db
      .prepare('INSERT INTO FeedItems (notion_block_id, title, url, created_at) VALUES (?, ?, ?, ?)')
      .bind(item.id, title, url, created_time)
      .run();

    // mark as processed
    await notion.pages.update({
      page_id: item.id,
      properties: {
        notion2rss: { checkbox: true },
      },
    });
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`triggered by cron at ${event.cron}`);
    await syncDatabase(env.NOTION_TOKEN, env.NOTION_DATABASE_ID, env.DB);
  },
  fetch: app.fetch,
};

function assertType<T extends string>(type: T, obj: { type: string }): asserts obj is { type: T } {
  if (obj.type !== type) {
    throw new Error(`unexpected type: ${obj.type}`);
  }
}
