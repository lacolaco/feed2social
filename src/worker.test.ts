import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from './models';

const mocks = vi.hoisted(() => ({
  fetchItems: vi.fn(),
  saveStatus: vi.fn(),
  createPostData: vi.fn(),
  twitterPost: vi.fn(),
  misskeyPost: vi.fn(),
  blueskyPost: vi.fn(),
}));

vi.mock('@notionhq/client', () => ({ Client: class {} }));
vi.mock('./repository', () => ({ fetchNewFeedItems: mocks.fetchItems, saveFeedItemStatus: mocks.saveStatus }));
vi.mock('./create-post', () => ({ createPostData: mocks.createPostData }));
vi.mock('./social/twitter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./social/twitter')>()),
  TwitterAdapter: class {
    getNetworkKey() {
      return 'twitter';
    }
    createPost(post: unknown) {
      return mocks.twitterPost(post);
    }
  },
}));
vi.mock('./social/misskey', () => ({
  MisskeyAdapter: class {
    getNetworkKey() {
      return 'misskey';
    }
    createPost(post: unknown) {
      return mocks.misskeyPost(post);
    }
  },
}));
vi.mock('./social/bluesky', () => ({
  BlueskyAdapter: class {
    getNetworkKey() {
      return 'bluesky';
    }
    createPost(post: unknown) {
      return mocks.blueskyPost(post);
    }
  },
}));

import { execute, type Env } from './worker';
import { TwitterCreditsDepletedError } from './social/twitter';

function item(id: string, completed: string[] = []): FeedItem {
  return { notionPageId: id, notionPageTitle: id, feedUrl: `https://example.com/${id}`, completedNetworkKeys: new Set(completed) };
}

function fixture() {
  const values = new Map<string, string>();
  const kv = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  const env = { SENTRY_RELEASE: 'test', NOTION_TOKEN: 'test', NOTION_DATA_SOURCE_ID: 'test', TWITTER_BREAKER: kv } as unknown as Env;
  const sentry = { addBreadcrumb: vi.fn(), captureException: vi.fn(), captureMessage: vi.fn() };
  return { env, kv, values, sentry };
}

describe('scheduled feed Twitter credit breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPostData.mockImplementation(async (feedItem: FeedItem) => ({
      title: feedItem.notionPageTitle,
      url: feedItem.feedUrl,
      note: null,
    }));
    mocks.fetchItems.mockImplementation(async () => [item('first'), item('second')]);
    mocks.saveStatus.mockResolvedValue(undefined);
    mocks.misskeyPost.mockResolvedValue(undefined);
    mocks.blueskyPost.mockResolvedValue(undefined);
    mocks.twitterPost.mockResolvedValue(undefined);
  });

  it('stores a 402 breaker across executions, notifies once, and still saves healthy networks', async () => {
    const { env, kv, sentry } = fixture();
    mocks.twitterPost.mockRejectedValue(new TwitterCreditsDepletedError('credits depleted'));

    await execute(env, sentry as never, false, new Date('2026-10-08T00:00:00Z'));
    expect(mocks.twitterPost).toHaveBeenCalledTimes(1);
    expect(mocks.misskeyPost).toHaveBeenCalledTimes(2);
    expect(mocks.blueskyPost).toHaveBeenCalledTimes(2);
    expect(mocks.saveStatus.mock.calls.map(([, feedItem]) => [...feedItem.completedNetworkKeys])).toEqual([
      ['misskey', 'bluesky'],
      ['misskey', 'bluesky'],
    ]);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledTimes(1);

    mocks.fetchItems.mockImplementation(async () => [item('first', ['misskey', 'bluesky']), item('second', ['misskey', 'bluesky'])]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await execute(env, sentry as never, false, new Date('2026-10-08T00:05:00Z'));
    expect(log.mock.calls.some(([message]) => typeof message === 'string' && message.startsWith('posting:'))).toBe(false);
    log.mockRestore();
    expect(mocks.twitterPost).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.fetchItems.mock.calls[1][3]).toBe(false);
  });

  it('probes once after the retry interval, then resumes remaining Twitter posts after recovery', async () => {
    const { env, kv, sentry } = fixture();
    mocks.twitterPost.mockRejectedValueOnce(new TwitterCreditsDepletedError('credits depleted'));
    await execute(env, sentry as never, false, new Date('2026-10-08T00:00:00Z'));
    mocks.fetchItems.mockImplementation(async () => [item('first', ['misskey', 'bluesky']), item('second', ['misskey', 'bluesky'])]);
    await execute(env, sentry as never, false, new Date('2026-10-08T01:00:00Z'));
    expect(mocks.twitterPost).toHaveBeenCalledTimes(3);
    expect(kv.delete).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith('Twitter credits recovered; posting resumed');
    expect(mocks.saveStatus.mock.calls.slice(-2).map(([, feedItem]) => [...feedItem.completedNetworkKeys])).toEqual([
      ['misskey', 'bluesky', 'twitter'],
      ['misskey', 'bluesky', 'twitter'],
    ]);
    expect(mocks.fetchItems.mock.calls[1][3]).toBe(true);
  });

  it('keeps the breaker open on another probe 402 without duplicate Sentry notifications', async () => {
    const { env, kv, sentry } = fixture();
    mocks.twitterPost.mockRejectedValue(new TwitterCreditsDepletedError('credits depleted'));
    await execute(env, sentry as never, false, new Date('2026-10-08T00:00:00Z'));
    await execute(env, sentry as never, false, new Date('2026-10-08T01:00:00Z'));
    expect(mocks.twitterPost).toHaveBeenCalledTimes(2);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledTimes(2);
    expect(JSON.parse(kv.put.mock.calls[1][1]).nextRetryAt).toBe('2026-10-08T02:00:00.000Z');
  });

  it('reports unrelated Twitter failures and leaves Twitter unfinished', async () => {
    const { env, kv, sentry } = fixture();
    const failure = new Error('Twitter API 401');
    mocks.twitterPost.mockRejectedValueOnce(failure);
    await execute(env, sentry as never, false, new Date('2026-10-08T00:00:00Z'));
    expect(sentry.captureException).toHaveBeenCalledWith(failure);
    expect(kv.put).not.toHaveBeenCalled();
    expect(mocks.twitterPost).toHaveBeenCalledTimes(2);
    expect([...mocks.saveStatus.mock.calls[0][1].completedNetworkKeys]).toEqual(['misskey', 'bluesky']);
  });

  it('continues healthy destinations and reports a KV write failure', async () => {
    const { env, kv, sentry } = fixture();
    const storageError = new Error('KV unavailable');
    kv.put.mockRejectedValueOnce(storageError);
    mocks.twitterPost.mockRejectedValue(new TwitterCreditsDepletedError('credits depleted'));
    await execute(env, sentry as never, false, new Date('2026-10-08T00:00:00Z'));
    expect(mocks.twitterPost).toHaveBeenCalledTimes(1);
    expect(mocks.saveStatus).toHaveBeenCalledTimes(2);
    expect(sentry.captureException).toHaveBeenCalledWith(storageError);
  });

  it('continues healthy destinations when breaker state cannot be read', async () => {
    const { env, kv, sentry } = fixture();
    const storageError = new Error('KV unavailable');
    kv.get.mockRejectedValueOnce(storageError);
    await execute(env, sentry as never, false, new Date('2026-10-08T00:00:00Z'));
    expect(mocks.twitterPost).not.toHaveBeenCalled();
    expect(mocks.misskeyPost).toHaveBeenCalledTimes(2);
    expect(mocks.saveStatus).toHaveBeenCalledTimes(2);
    expect(sentry.captureException).toHaveBeenCalledWith(storageError);
  });

  it('keeps retrying recovery after a KV delete failure while saving completed posts', async () => {
    const { env, kv, values, sentry } = fixture();
    values.set('twitter-credits-v1', JSON.stringify({ openedAt: '2026-10-08T00:00:00.000Z', nextRetryAt: '2026-10-08T01:00:00.000Z' }));
    const storageError = new Error('KV unavailable');
    kv.delete.mockRejectedValueOnce(storageError);
    mocks.fetchItems.mockImplementation(async () => [item('first', ['misskey', 'bluesky']), item('second', ['misskey', 'bluesky'])]);

    await execute(env, sentry as never, false, new Date('2026-10-08T01:00:00Z'));

    expect(kv.delete).toHaveBeenCalledTimes(2);
    expect(mocks.twitterPost).toHaveBeenCalledTimes(2);
    expect(mocks.saveStatus.mock.calls.map(([, feedItem]) => [...feedItem.completedNetworkKeys])).toEqual([
      ['misskey', 'bluesky', 'twitter'],
      ['misskey', 'bluesky', 'twitter'],
    ]);
    expect(sentry.captureException).toHaveBeenCalledWith(storageError);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });
});
