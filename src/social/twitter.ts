import encBase64 from 'crypto-js/enc-base64';
import hmacSha1 from 'crypto-js/hmac-sha1';
import OAuth from 'oauth-1.0a';
import { truncate } from 'tweet-truncator';
import { FeedItem, SocialPostSender } from '../models';

export class TwitterPostSender implements SocialPostSender {
  constructor(
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    private readonly accessToken: string,
    private readonly accessSecret: string,
  ) {}

  /**
   * @see https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
   */
  async sendPost(item: FeedItem): Promise<void> {
    const text = truncate(
      { desc: item.note, title: item.title, url: item.url, tags: ['laco_feed'] },
      {
        defaultPrefix: '🔖',
        template: '%desc% "%title%" %url% %tags%',
        truncatedOrder: ['title', 'desc'],
      },
    );

    const resp = await this.fetchWithAuth('https://api.twitter.com/2/tweets', 'POST', { text });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(body);
      throw new Error(`failed to post to Twitter`);
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
