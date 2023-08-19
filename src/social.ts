import { BskyAgent, RichText } from '@atproto/api';
import encBase64 from 'crypto-js/enc-base64';
import hmacSha1 from 'crypto-js/hmac-sha1';
import OAuth from 'oauth-1.0a';
import { truncate } from 'tweet-truncator';
import { FeedItem } from './models';

/**
 * Post a message to Misskey.
 *
 * @see https://misskey-hub.net/docs/api/endpoints/notes/create.html
 */
export async function createMisskeyNote(item: FeedItem, authToken: string) {
  const text = `🔖 ${item.note ? `${item.note} "${item.title}"` : `"${item.title}"`} ${item.url} #laco_feed`;
  await fetch('https://misskey.io/api/notes/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text, i: authToken }),
  });
}

const bsky = new BskyAgent({ service: 'https://bsky.social' });

/**
 * Post a message to Bluesky.
 */
export async function createBlueskyPost(item: FeedItem, auth: { identifier: string; password: string }) {
  await bsky.login({ identifier: auth.identifier, password: auth.password });

  const text = `🔖 ${item.note ? `${item.note} "${item.title}"` : `"${item.title}"`} ${item.url}`;

  const rt = new RichText({ text });
  await rt.detectFacets(bsky);

  await bsky.post({ text: rt.text, facets: rt.facets });
}

/**
 * Post a message to Twitter.
 *
 * @see https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
 */
export async function createTwitterPost(
  item: FeedItem,
  auth: { consumerKey: string; consumerSecret: string; accessToken: string; accessSecret: string },
) {
  const text = truncate(
    { desc: item.note, title: item.title, url: item.url, tags: ['laco_feed'] },
    {
      defaultPrefix: '🔖',
      template: '%desc% "%title%" %url% %tags%',
      truncatedOrder: ['title', 'desc'],
    },
  );

  const req: OAuth.RequestOptions = {
    url: 'https://api.twitter.com/2/tweets',
    method: 'POST',
    data: { text },
    includeBodyHash: true, // v1.1における `include_entities` に相当
  };

  const oauth = new OAuth({
    consumer: { key: auth.consumerKey, secret: auth.consumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function(base_string, key) {
      return hmacSha1(base_string, key).toString(encBase64);
    },
  });

  const oauthHeader = oauth.toHeader(oauth.authorize(req, { key: auth.accessToken, secret: auth.accessSecret }));
  const resp = await fetch(req.url, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      ...oauthHeader,
    },
    body: JSON.stringify(req.data),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(body);
    throw new Error(`failed to post to Twitter`);
  }
}
