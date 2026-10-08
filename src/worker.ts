import { Client as NotionClient } from '@notionhq/client';
import { ExecutionContext, Hono } from 'hono';
import { createPostData } from './create-post';
import { FeedItem, SocialNetworkAdapter } from './models';
import { initSentry, Sentry } from './observability/sentry';
import { fetchNewFeedItems, saveFeedItemStatus } from './repository';
import { BlueskyAdapter } from './social/bluesky';
import { MisskeyAdapter } from './social/misskey';
import { TwitterAdapter, TwitterCreditsDepletedError } from './social/twitter';
import { canAttemptTwitter, creditsDepleted, twitterRecovered, type TwitterBreakerState } from './twitter-breaker';

export type Env = {
  SENTRY_DSN: string;
  SENTRY_RELEASE: string;
  NOTION_TOKEN: string;
  NOTION_DATA_SOURCE_ID: string;
  MISSKEY_TOKEN: string;
  BSKY_ID: string;
  BSKY_PASSWORD: string;
  TWITTER_API_KEY: string;
  TWITTER_API_SECRET: string;
  TWITTER_ACCESS_TOKEN: string;
  TWITTER_ACCESS_SECRET: string;
  TWITTER_BREAKER: KVNamespace;
};

const isDevelopment = process.env.NODE_ENV === 'development';
const TWITTER_BREAKER_KEY = 'twitter-credits-v1';

async function readTwitterBreaker(env: Env, sentry: Sentry, dryRun: boolean): Promise<TwitterBreakerState> {
  if (dryRun) return { kind: 'closed' };
  try {
    const stored = await env.TWITTER_BREAKER.get(TWITTER_BREAKER_KEY);
    if (!stored) return { kind: 'closed' };
    return { kind: 'open', ...JSON.parse(stored) };
  } catch (error) {
    console.error('failed to read Twitter credits breaker:', error);
    sentry.captureException(error);
    return { kind: 'unavailable' };
  }
}

async function recordTwitterDepletion(
  state: TwitterBreakerState,
  now: Date,
  error: TwitterCreditsDepletedError,
  env: Env,
  sentry: Sentry,
): Promise<TwitterBreakerState> {
  const transition = creditsDepleted(state, now);
  try {
    const { openedAt, nextRetryAt } = transition.state;
    await env.TWITTER_BREAKER.put(TWITTER_BREAKER_KEY, JSON.stringify({ openedAt, nextRetryAt }));
  } catch (storageError) {
    console.error('failed to save Twitter credits breaker:', storageError);
    sentry.captureException(storageError);
    return transition.state;
  }
  console.warn(`Twitter credits breaker open; next retry: ${transition.state.nextRetryAt}`);
  if (transition.notify) sentry.captureException(error);
  return transition.state;
}

async function recordTwitterRecovery(state: TwitterBreakerState, env: Env, sentry: Sentry): Promise<TwitterBreakerState> {
  const transition = twitterRecovered(state);
  if (!transition.notify) return state;
  try {
    await env.TWITTER_BREAKER.delete(TWITTER_BREAKER_KEY);
    console.info('Twitter credits recovered; posting resumed');
    sentry.captureMessage('Twitter credits recovered; posting resumed');
    return transition.state;
  } catch (error) {
    console.error('failed to clear Twitter credits breaker:', error);
    sentry.captureException(error);
    return state;
  }
}

export async function execute(env: Env, sentry: Sentry, dryRun = false, now = new Date()) {
  // Bind fetch to globalThis to avoid Illegal Invocation errors.
  // // This is necessary because of Cloudflare Workers' isolation of the global scope.
  // https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors
  // https://zenn.dev/sui_water/articles/3329c4b318d934
  const boundFetch = globalThis.fetch.bind(globalThis);
  const notion = new NotionClient({ auth: env.NOTION_TOKEN, fetch: boundFetch });
  const allNetworkAdapters: SocialNetworkAdapter[] = [
    new MisskeyAdapter(env.MISSKEY_TOKEN),
    new BlueskyAdapter(env.BSKY_ID, env.BSKY_PASSWORD),
    new TwitterAdapter(env.TWITTER_API_KEY, env.TWITTER_API_SECRET, env.TWITTER_ACCESS_TOKEN, env.TWITTER_ACCESS_SECRET),
  ];
  console.log('release:', env.SENTRY_RELEASE);
  if (dryRun) {
    console.log('[DRY RUN] mode enabled - no actual posting or status updates will occur');
  }
  let twitterBreaker = await readTwitterBreaker(env, sentry, dryRun);
  if (twitterBreaker.kind === 'open') console.log(`Twitter credits breaker open; next retry: ${twitterBreaker.nextRetryAt}`);
  sentry.addBreadcrumb({ level: 'log', message: 'fetching new feed items' });

  let incomingFeedItems: FeedItem[] = [];
  try {
    incomingFeedItems = await fetchNewFeedItems(notion, env.NOTION_DATA_SOURCE_ID, now, canAttemptTwitter(twitterBreaker, now));
    console.log(`new items: ${incomingFeedItems.length}`);
  } catch (e) {
    throw new Error(`failed to fetch new feed items: ${e}`, { cause: e });
  }

  sentry.addBreadcrumb({ level: 'log', message: 'posting feed items to social' });

  for (const feedItem of incomingFeedItems) {
    // 1 件の処理失敗 (Notion 5xx、status 更新失敗、createPost 後の予期せぬ例外) が
    // バッチ全体を中止させると、同じバッチの後続アイテムが次のティックで再投稿対象になり、
    // すでに成功したネットワークへ重複投稿される。各アイテムを独立した try/catch で隔離する。
    try {
      const networks = allNetworkAdapters.filter(
        (network) =>
          !feedItem.completedNetworkKeys.has(network.getNetworkKey()) &&
          (network.getNetworkKey() !== 'twitter' || canAttemptTwitter(twitterBreaker, now)),
      );
      if (networks.length === 0) continue;
      sentry.addBreadcrumb({ level: 'log', message: 'posting feed item to social', data: feedItem });
      console.log(`posting: ${JSON.stringify(feedItem, null, 2)}`);
      console.log(`posted to ${networks.map((network) => network.getNetworkKey()).join(', ')}`);

      const post = await createPostData(feedItem);
      console.log(`post data: ${JSON.stringify(post, null, 2)}`);

      const results = await Promise.allSettled(
        networks.map(async (network) => {
          if (dryRun) {
            console.log(`[DRY RUN] would post to ${network.getNetworkKey()}: ${JSON.stringify(post, null, 2)}`);
          } else {
            await network.createPost(post);
          }
          return { network: network.getNetworkKey(), status: 'ok' };
        }),
      );
      for (const [index, result] of results.entries()) {
        const networkKey = networks[index].getNetworkKey();
        if (result.status === 'rejected') {
          if (networkKey === 'twitter' && result.reason instanceof TwitterCreditsDepletedError && !dryRun) {
            twitterBreaker = await recordTwitterDepletion(twitterBreaker, now, result.reason, env, sentry);
            continue;
          }
          console.error(`failed to post: ${result.reason}`);
          sentry.captureException(result.reason);
          continue;
        }
        const { network } = result.value;
        feedItem.completedNetworkKeys.add(network);
        if (network === 'twitter' && !dryRun) twitterBreaker = await recordTwitterRecovery(twitterBreaker, env, sentry);
      }
      if (dryRun) {
        console.log(`[DRY RUN] would save feed item status for: ${feedItem.notionPageId}`);
      } else {
        await saveFeedItemStatus(notion, feedItem);
      }
    } catch (e) {
      console.error(`failed to process feed item ${feedItem.notionPageId}:`, e);
      sentry.captureException(e);
    }
  }

  sentry.addBreadcrumb({ level: 'log', message: 'done' });
}

const app = new Hono<{ Bindings: Env }>();

if (isDevelopment) {
  // for debugging
  app.get('/_/execute', async (c) => {
    const sentry = initSentry(c.env.SENTRY_DSN, c.env.SENTRY_RELEASE, c.executionCtx);
    const url = new URL(c.req.url);
    console.log(`triggered by fetch at ${url.toString()}`);
    try {
      await execute(c.env, sentry, true);
      return c.text('ok');
    } catch (e) {
      console.error(e);
      sentry.captureException(e);
      return c.text('error', 500);
    } finally {
      sentry.captureMessage('done');
    }
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const sentry = initSentry(env.SENTRY_DSN, env.SENTRY_RELEASE, ctx);
    sentry.setContext('event', { cron: event.cron, scheduledTime: event.scheduledTime });
    const checkInId = sentry.captureCheckIn({ monitorSlug: 'scheduled-feed2social', status: 'in_progress' });
    ctx.waitUntil(
      execute(env, sentry)
        .then(() => {
          sentry.captureCheckIn({ checkInId, monitorSlug: 'scheduled-feed2social', status: 'ok' });
        })
        .catch((e) => {
          console.error(e);
          sentry.captureException(e);
          sentry.captureCheckIn({ checkInId, monitorSlug: 'scheduled-feed2social', status: 'error' });
          throw e;
        }),
    );
  },
  fetch: app.fetch,
};
