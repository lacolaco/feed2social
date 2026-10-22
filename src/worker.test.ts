import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from './models';

const mocks = vi.hoisted(() => ({
  fetchItems: vi.fn(),
  saveStatus: vi.fn(),
  saveUrl: vi.fn(),
  createPostData: vi.fn(),
  twitterPost: vi.fn(),
  misskeyPost: vi.fn(),
  blueskyPost: vi.fn(),
}));
vi.mock('@notionhq/client', () => ({ Client: class {} }));
vi.mock('./repository', () => ({
  fetchNewFeedItems: mocks.fetchItems,
  saveFeedItemStatus: mocks.saveStatus,
  saveFeedItemUrl: mocks.saveUrl,
}));
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
import { execute, isCreditsReportWindow, type Env } from './worker';
import { TwitterCreditsDepletedError } from './social/twitter';

function item(id: string, completed: string[] = [], notionUrl = `https://example.com/${id}`): FeedItem {
  return {
    notionPageId: id,
    notionPageTitle: id,
    feedUrl: `https://example.com/${id}`,
    notionUrl,
    completedNetworkKeys: new Set(completed),
  };
}
const env = { SENTRY_RELEASE: 'test', NOTION_TOKEN: 'test', NOTION_DATA_SOURCE_ID: 'test' } as Env;
function sentry() {
  const scope = { setFingerprint: vi.fn(), captureException: vi.fn() };
  return {
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    scope,
    withScope: vi.fn((callback: (scope: unknown) => void) => callback(scope)),
  };
}
const inWindow = Date.UTC(2026, 9, 13, 0, 0);
const outOfWindow = Date.UTC(2026, 9, 13, 0, 5);

describe('isCreditsReportWindow', () => {
  it.each([
    [Date.UTC(2026, 9, 12, 23, 59, 59, 999), false],
    [Date.UTC(2026, 9, 13, 0, 0, 0, 0), true],
    [Date.UTC(2026, 9, 13, 0, 4, 59, 999), true],
    [Date.UTC(2026, 9, 13, 0, 5, 0, 0), false],
  ])('%i -> %s', (time, expected) => {
    expect(isCreditsReportWindow(time)).toBe(expected);
  });
});

describe('Twitter credits depletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchItems.mockImplementation(async () => [item('first'), item('second')]);
    mocks.createPostData.mockImplementation(async (feedItem: FeedItem) => ({
      title: feedItem.notionPageTitle,
      url: feedItem.feedUrl,
      note: null,
    }));
    mocks.saveStatus.mockResolvedValue(undefined);
    mocks.misskeyPost.mockResolvedValue(undefined);
    mocks.blueskyPost.mockResolvedValue(undefined);
    mocks.twitterPost.mockResolvedValue(undefined);
  });

  it('sends one fixed-fingerprint event per run inside the report window regardless of item count', async () => {
    const monitor = sentry();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.twitterPost.mockRejectedValue(new TwitterCreditsDepletedError('Twitter API 402 credits depleted'));
    await execute(env, monitor as never, false, inWindow);
    expect(monitor.withScope).toHaveBeenCalledTimes(1);
    expect(monitor.scope.setFingerprint).toHaveBeenCalledWith(['twitter-credits-depleted']);
    expect(monitor.scope.captureException).toHaveBeenCalledTimes(1);
    expect(monitor.captureException).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });

  it('warns once per run without Sentry exceptions while saving healthy networks and retrying unfinished Twitter items', async () => {
    const monitor = sentry();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.twitterPost.mockRejectedValue(new TwitterCreditsDepletedError('Twitter API 402 credits depleted'));
    await execute(env, monitor as never, false, outOfWindow);
    expect(mocks.twitterPost).toHaveBeenCalledTimes(2);
    expect(mocks.misskeyPost).toHaveBeenCalledTimes(2);
    expect(mocks.blueskyPost).toHaveBeenCalledTimes(2);
    expect(mocks.saveStatus.mock.calls.map(([, feedItem]) => [...feedItem.completedNetworkKeys])).toEqual([
      ['misskey', 'bluesky'],
      ['misskey', 'bluesky'],
    ]);
    expect(monitor.captureException).not.toHaveBeenCalled();
    expect(monitor.withScope).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);

    mocks.fetchItems.mockImplementation(async () => [item('first', ['misskey', 'bluesky']), item('second', ['misskey', 'bluesky'])]);
    await execute(env, monitor as never, false, outOfWindow);
    expect(mocks.twitterPost).toHaveBeenCalledTimes(4);
    expect(mocks.misskeyPost).toHaveBeenCalledTimes(2);
    expect(mocks.blueskyPost).toHaveBeenCalledTimes(2);
    expect(monitor.captureException).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(2);
    expect(mocks.saveStatus.mock.calls.slice(2).map(([, feedItem]) => [...feedItem.completedNetworkKeys])).toEqual([
      ['misskey', 'bluesky'],
      ['misskey', 'bluesky'],
    ]);
    warning.mockRestore();
  });

  it('reports unexpected Twitter errors and leaves Twitter unfinished', async () => {
    const monitor = sentry();
    const error = new Error('Twitter API 401');
    mocks.twitterPost.mockRejectedValueOnce(error);
    await execute(env, monitor as never);
    expect(monitor.captureException).toHaveBeenCalledWith(error);
    expect(mocks.twitterPost).toHaveBeenCalledTimes(2);
    expect([...mocks.saveStatus.mock.calls[0][1].completedNetworkKeys]).toEqual(['misskey', 'bluesky']);
  });
});

describe('Notion url normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPostData.mockImplementation(async (feedItem: FeedItem) => ({
      title: feedItem.notionPageTitle,
      url: feedItem.feedUrl,
      note: null,
    }));
    mocks.saveStatus.mockResolvedValue(undefined);
    mocks.saveUrl.mockResolvedValue(undefined);
    mocks.misskeyPost.mockResolvedValue(undefined);
    mocks.blueskyPost.mockResolvedValue(undefined);
    mocks.twitterPost.mockResolvedValue(undefined);
  });

  it('updates the url only for items whose url changed', async () => {
    mocks.fetchItems.mockResolvedValue([item('changed', [], 'https://example.com/changed?utm_source=x'), item('same')]);
    await execute(env, sentry() as never);
    expect(mocks.saveUrl).toHaveBeenCalledTimes(1);
    expect(mocks.saveUrl.mock.calls[0][1]).toMatchObject({ notionPageId: 'changed', feedUrl: 'https://example.com/changed' });
  });

  it('does not update the url in dry-run mode', async () => {
    mocks.fetchItems.mockResolvedValue([item('changed', [], 'https://example.com/changed?utm_source=x')]);
    await execute(env, sentry() as never, true);
    expect(mocks.saveUrl).not.toHaveBeenCalled();
  });

  it('keeps posting, saving status, and processing other items when the url update fails', async () => {
    const monitor = sentry();
    const error = new Error('notion 500');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.saveUrl.mockRejectedValueOnce(error);
    mocks.fetchItems.mockResolvedValue([
      item('first', [], 'https://example.com/first?utm_source=x'),
      item('second', [], 'https://example.com/second?utm_source=x'),
    ]);
    await execute(env, monitor as never);
    expect(monitor.captureException).toHaveBeenCalledWith(error, { tags: { notionPageId: 'first' } });
    expect(mocks.saveUrl).toHaveBeenCalledTimes(2);
    expect(mocks.twitterPost).toHaveBeenCalledTimes(2);
    expect(mocks.saveStatus).toHaveBeenCalledTimes(2);
    errorLog.mockRestore();
  });
});
