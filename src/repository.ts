import { Client as NotionClient, collectPaginatedAPI, PageObjectResponse } from '@notionhq/client';
import { FeedItem } from './models';
import { sanitizeTrackingParams } from './sanitize-url';

type NotionProperty<T extends string> = PageObjectResponse['properties'][string] & { type: T };

// `this_week` はワークスペースのタイムゾーン基準で「現在のカレンダー週」だけを含むため、
// 週の切り替わりや投稿し損ねたブックマークが永久に拾われなくなる境界バグがあった。
// 固定ローリング窓 (現在時刻から past N 日) で取りこぼしを防ぐ。
const FEED_ITEM_LOOKBACK_DAYS = 8;

export function buildFeedItemFilter(now: Date) {
  const since = new Date(now.getTime() - FEED_ITEM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return {
    and: [
      { timestamp: 'created_time' as const, created_time: { on_or_after: since } },
      { property: 'url', url: { is_not_empty: true as const } },
      { property: 'feed2social', checkbox: { does_not_equal: true } },
      {
        or: [
          { property: 'feed2social_completed', multi_select: { does_not_contain: 'misskey' } },
          { property: 'feed2social_completed', multi_select: { does_not_contain: 'bluesky' } },
          { property: 'feed2social_completed', multi_select: { does_not_contain: 'twitter' } },
        ],
      },
    ],
  };
}

export async function fetchNewFeedItems(notion: NotionClient, dataSourceId: string, now: Date = new Date()): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  // Notion API v2025-09-03 で query は data source 単位に変更された。
  // 呼び出し側 (`worker.ts`) が `NOTION_DATA_SOURCE_ID` を直接渡す前提。
  const pages = await collectPaginatedAPI(notion.dataSources.query, {
    data_source_id: dataSourceId,
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    filter: buildFeedItemFilter(now),
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

    const url = sanitizeTrackingParams(properties.url.url ?? '');
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

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe('buildFeedItemFilter', () => {
    it('uses an 8-day rolling window on created_time instead of this_week', () => {
      const now = new Date('2026-06-22T03:00:00.000Z');
      const filter = buildFeedItemFilter(now);
      expect(filter.and[0]).toEqual({
        timestamp: 'created_time',
        created_time: { on_or_after: '2026-06-14T03:00:00.000Z' },
      });
    });

    it('keeps url, feed2social, and per-network OR clauses intact', () => {
      const filter = buildFeedItemFilter(new Date('2026-06-22T00:00:00.000Z'));
      expect(filter.and[1]).toEqual({ property: 'url', url: { is_not_empty: true } });
      expect(filter.and[2]).toEqual({ property: 'feed2social', checkbox: { does_not_equal: true } });
      const orClause = filter.and[3] as { or: Array<{ multi_select: { does_not_contain: string } }> };
      expect(orClause.or.map((c) => c.multi_select.does_not_contain)).toEqual(['misskey', 'bluesky', 'twitter']);
    });
  });
}
