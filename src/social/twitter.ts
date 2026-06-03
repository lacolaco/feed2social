import encBase64 from 'crypto-js/enc-base64';
import hmacSha1 from 'crypto-js/hmac-sha1';
import OAuth from 'oauth-1.0a';
import { truncate } from 'tweet-truncator';
import { PostData, SocialNetworkAdapter } from '../models';

export class TwitterAdapter implements SocialNetworkAdapter {
  constructor(
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    private readonly accessToken: string,
    private readonly accessSecret: string,
  ) {}

  getNetworkKey(): string {
    return 'twitter';
  }

  /**
   * @see https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
   */
  async createPost(post: PostData): Promise<void> {
    const text = buildText(post);

    const resp = await this.fetchWithAuth('https://api.twitter.com/2/tweets', 'POST', { text });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(body);
      throw new Error(`failed to post to Twitter`, {
        cause: new Error(`Twitter API ${resp.status} ${resp.statusText}: ${body}`),
      });
    }
  }

  async fetchWithAuth(url: string, method: string, body: object) {
    const oauth = new OAuth({
      consumer: { key: this.consumerKey, secret: this.consumerSecret },
      signature_method: 'HMAC-SHA1',
      hash_function(base_string, key) {
        return hmacSha1(base_string, key).toString(encBase64);
      },
    });
    const oauthHeaders = oauth.toHeader(
      oauth.authorize({ url, method, data: body, includeBodyHash: true }, { key: this.accessToken, secret: this.accessSecret }),
    );

    return fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...oauthHeaders },
      body: JSON.stringify(body),
    });
  }
}

function buildText(post: PostData) {
  return truncate(
    { desc: post.note ?? '', title: post.title, url: post.url, tags: ['laco_feed'] },
    { defaultPrefix: '🔖', template: '%desc% "%title%" %url% %tags%', truncatedOrder: ['title', 'desc'] },
  );
}

// in-source test suites
if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;
  describe('buildText', () => {
    it('without note', () => {
      const text = buildText({
        url: 'https://example.com',
        title: 'example',
        note: null,
      });
      expect(text).toBe('🔖 "example" https://example.com #laco_feed');
    });

    it('with note', () => {
      const text = buildText({
        url: 'https://example.com',
        title: 'example',
        note: 'note',
      });
      expect(text).toBe('note "example" https://example.com #laco_feed');
    });
  });

  describe('TwitterAdapter.createPost', () => {
    afterEach(() => vi.restoreAllMocks());

    it('API が non-2xx を返したら cause 付きで Error を throw する', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"title":"Too Many Requests"}', { status: 429, statusText: 'Too Many Requests' }),
      );
      const adapter = new TwitterAdapter('ck', 'cs', 'at', 'as');
      await expect(adapter.createPost({ title: 't', url: 'https://example.com', note: null })).rejects.toMatchObject({
        message: 'failed to post to Twitter',
        cause: expect.objectContaining({
          message: expect.stringContaining('429'),
        }),
      });
    });

    it('cause には response body が含まれ Sentry で root cause を観測可能', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"errors":[{"message":"Could not authenticate you"}]}', { status: 401, statusText: 'Unauthorized' }),
      );
      const adapter = new TwitterAdapter('ck', 'cs', 'at', 'as');
      try {
        await adapter.createPost({ title: 't', url: 'https://example.com', note: null });
        expect.unreachable('createPost should have thrown');
      } catch (e) {
        const error = e as Error & { cause?: Error };
        expect(error.cause?.message).toContain('Could not authenticate you');
        expect(error.cause?.message).toContain('401');
      }
    });
  });
}
