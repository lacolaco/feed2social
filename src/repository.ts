import { Client as NotionClient, iteratePaginatedAPI } from '@notionhq/client';
import { FeedItem } from './models';
import { fetchPageTitle } from './utils';

export async function fetchNewFeedItems(notion: NotionClient, notionDatabaseId: string): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  for await (const block of iteratePaginatedAPI(notion.databases.query, {
    database_id: notionDatabaseId,
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    filter: {
      and: [
        { timestamp: 'created_time', created_time: { this_week: {} } },
        { property: 'feed2social', checkbox: { equals: false } },
        { property: 'url', url: { is_not_empty: true } },
      ],
    },
  })) {
    if (block.object !== 'page' || !('properties' in block)) {
      console.log(`skipped: ${block.id} is not a page`);
      continue;
    }
    const { properties } = block;
    assertType('title', properties.title);
    assertType('url', properties.url);

    const url = properties.url.url ?? '';
    if (url === '') {
      console.log(`skipped: ${block.id} has no url`);
      continue;
    }
    const title = await fetchPageTitle(url);
    if (title === '') {
      console.log(`skipped: ${block.id} has no title`);
      continue;
    }
    const notionTitle = properties.title.title.map((t) => t.plain_text).join('');
    // title and notionTitle must be different
    const note = !title.includes(notionTitle) && !notionTitle.includes(title) ? notionTitle : undefined;

    items.push({ notionBlockId: block.id, title, url, note });
  }

  return items;
}

export async function markFeedItemAsProcessed(notion: NotionClient, item: FeedItem) {
  return await notion.pages.update({
    page_id: item.notionBlockId,
    properties: {
      // update title
      title: { title: [{ type: 'text', text: { content: item.title } }] },
      feed2social: { checkbox: true },
    },
  });
}

function assertType<T extends string>(type: T, obj: { type: string }): asserts obj is { type: T } {
  if (obj.type !== type) {
    throw new Error(`unexpected type: ${obj.type}`);
  }
}
