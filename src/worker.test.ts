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
const env = { SENTRY_RELEASE: 'test', NOTION_TOKEN: 'test', NOTION_DATA_SOURCE_ID: 'test' } as Env;
function sentry() {
  return { addBreadcrumb: vi.fn(), captureException: vi.fn() };
}

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

  it('warns once per run without Sentry exceptions while saving healthy networks and retrying unfinished Twitter items', async () => {
    const monitor = sentry();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.twitterPost.mockRejectedValue(new TwitterCreditsDepletedError('Twitter API 402 credits depleted'));
    await execute(env, monitor as never);
    expect(mocks.twitterPost).toHaveBeenCalledTimes(2);
    expect(mocks.misskeyPost).toHaveBeenCalledTimes(2);
    expect(mocks.blueskyPost).toHaveBeenCalledTimes(2);
    expect(mocks.saveStatus.mock.calls.map(([, feedItem]) => [...feedItem.completedNetworkKeys])).toEqual([
      ['misskey', 'bluesky'],
      ['misskey', 'bluesky'],
    ]);
    expect(monitor.captureException).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);

    mocks.fetchItems.mockImplementation(async () => [item('first', ['misskey', 'bluesky']), item('second', ['misskey', 'bluesky'])]);
    await execute(env, monitor as never);
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
