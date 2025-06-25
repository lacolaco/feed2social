import { Client as NotionClient, collectPaginatedAPI } from '@notionhq/client';
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { FeedItem } from './models';

type NotionProperty<T extends string> = PageObjectResponse['properties'][string] & { type: T };

export async function fetchNewFeedItems(notion: NotionClient, notionDatabaseId: string): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  const pages = await collectPaginatedAPI(notion.databases.query, {
    database_id: notionDatabaseId,
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    filter: {
      and: [
        // 前週以前のものは除外
        { timestamp: 'created_time', created_time: { this_week: {} } },
        // URLが空のものは除外
        { property: 'url', url: { is_not_empty: true } },
        // feed2socialがtrueのものは除外
        { property: 'feed2social', checkbox: { does_not_equal: true } },
        // feed2social_completedがmisskey, bluesky, twitterのいずれかを含まないもの
        {
          or: [
            { property: 'feed2social_completed', multi_select: { does_not_contain: 'misskey' } },
            { property: 'feed2social_completed', multi_select: { does_not_contain: 'bluesky' } },
            { property: 'feed2social_completed', multi_select: { does_not_contain: 'twitter' } },
          ],
        },
      ],
    },
  });
  for (const page of pages) {
    if (page.object !== 'page' || !('properties' in page)) {
      console.log(`skipped: ${page.id} is not a page`);
      continue;
    }
    const properties = page.properties as {
      title: NotionProperty<'title'>;
      url: NotionProperty<'url'>;
      feed2social_completed: NotionProperty<'multi_select'>;
    };
    assertPropertyType(properties.title, 'title');
    assertPropertyType(properties.url, 'url');
    assertPropertyType(properties.feed2social_completed, 'multi_select');

    const url = properties.url.url ?? '';
    if (url === '') {
      console.log(`skipped: ${page.id} has no url`);
      continue;
    }
    const notionPageTitle = properties.title.title.map((t) => t.plain_text).join('');
    const completedNetworkKeys = new Set(properties.feed2social_completed.multi_select.map((s) => s.name));

    items.push({ notionPageId: page.id, notionPageTitle, feedUrl: url, completedNetworkKeys });
  }
  return items;
}

export async function saveFeedItemStatus(notion: NotionClient, item: FeedItem) {
  return await notion.pages.update({
    page_id: item.notionPageId,
    properties: {
      feed2social_completed: {
        multi_select: Array.from(item.completedNetworkKeys).map((key) => ({ name: key })),
      },
    },
  });
}

function assertPropertyType<T extends string>(obj: { type: string }, type: T): asserts obj is { type: T } {
  if (obj.type !== type) {
    throw new Error(`unexpected type: ${obj.type}`);
  }
}
