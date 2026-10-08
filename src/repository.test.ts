import { describe, expect, it, vi } from 'vitest';
import { fetchNewFeedItems } from './repository';

describe('unfinished Twitter backlog', () => {
  it('queries unfinished Twitter items without a created_time cutoff when retries are allowed', async () => {
    const query = vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    const notion = { dataSources: { query } };
    await fetchNewFeedItems(notion as never, 'feed', new Date('2026-10-08T00:00:00Z'), true);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0].filter.and[0]).toHaveProperty('timestamp', 'created_time');
    expect(query.mock.calls[1][0].filter).toEqual({
      and: [
        { property: 'url', url: { is_not_empty: true } },
        { property: 'feed2social', checkbox: { does_not_equal: true } },
        { property: 'feed2social_completed', multi_select: { does_not_contain: 'twitter' } },
      ],
    });
  });

  it('does not query the historical backlog while the breaker is waiting', async () => {
    const query = vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    await fetchNewFeedItems({ dataSources: { query } } as never, 'feed', new Date('2026-10-08T00:00:00Z'), false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns an old unfinished Twitter item for recovery without marking it complete', async () => {
    const oldPage = {
      object: 'page',
      id: 'old',
      created_time: '2026-09-01T00:00:00Z',
      properties: {
        title: { type: 'title', title: [{ plain_text: 'old article' }] },
        url: { type: 'url', url: 'https://example.com/old' },
        feed2social_completed: { type: 'multi_select', multi_select: [{ name: 'misskey' }, { name: 'bluesky' }] },
      },
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ results: [], has_more: false, next_cursor: null })
      .mockResolvedValueOnce({ results: [oldPage], has_more: false, next_cursor: null });
    const items = await fetchNewFeedItems({ dataSources: { query } } as never, 'feed', new Date('2026-10-08T00:00:00Z'), true);
    expect(items).toHaveLength(1);
    expect(items[0].notionPageId).toBe('old');
    expect([...items[0].completedNetworkKeys]).toEqual(['misskey', 'bluesky']);
  });
});
