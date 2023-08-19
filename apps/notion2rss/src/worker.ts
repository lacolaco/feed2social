export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  // MY_KV_NAMESPACE: KVNamespace;
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;
  //
  // Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
  // MY_SERVICE: Fetcher;
  //
  // Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
  // MY_QUEUE: Queue;
  //
  // Example binding to a D1 Database. Learn more at https://developers.cloudflare.com/workers/platform/bindings/#d1-database-bindings
  // DB: D1Database
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
}

import { Client, iteratePaginatedAPI } from '@notionhq/client';

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`triggered by cron at ${event.cron}`);
    await execute(env, ctx);
  },
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    console.log(`triggered by fetch at ${url.toString()}`);

    if (url.pathname !== '/execute') {
      return new Response('Not Found', { status: 404 });
    }

    await execute(env, ctx);
    return new Response('OK');
  },
};

async function execute(env: Env, ctx: ExecutionContext) {
  // Initializing a client
  const notion = new Client({
    auth: env.NOTION_TOKEN,
  });

  const newItems = [];

  for await (const block of iteratePaginatedAPI(notion.databases.query, {
    database_id: env.NOTION_DATABASE_ID,
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
    console.log(JSON.stringify(block));
    newItems.push(block);
  }
  console.log(`new items: ${newItems.length}`);

  // mark as processed
  for (const item of newItems) {
    await notion.pages.update({
      page_id: item.id,
      properties: {
        notion2rss: { checkbox: true },
      },
    });
  }
}
