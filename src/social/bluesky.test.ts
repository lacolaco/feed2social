import { beforeEach, describe, expect, it, vi } from 'vitest';

// AtpAgent は読み込み時の fetch を取り込むので、bluesky.ts の読み込み前に差し替える。実通信は行わない。
const net = vi.hoisted(() => {
  const calls: { url: string; body: unknown }[] = [];
  let respond: (url: string) => Response = () => {
    throw new Error('unexpected request');
  };
  const decodeBody = (body: unknown) =>
    typeof body === 'string' ? JSON.parse(body) : body instanceof Uint8Array ? JSON.parse(new TextDecoder().decode(body)) : undefined;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: input instanceof Request ? decodeBody(await input.clone().text()) : decodeBody(init?.body) });
    return respond(url);
  };
  globalThis.fetch = fetchMock as typeof fetch;
  return {
    calls,
    setResponder: (fn: (url: string) => Response) => {
      respond = fn;
    },
  };
});

import { BlueskyAdapter } from './bluesky';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const jwt = (payload: object) =>
  ['{"alg":"none"}', JSON.stringify(payload), 'sig'].map((s, i) => (i === 2 ? s : Buffer.from(s).toString('base64url'))).join('.');

const session = {
  did: 'did:plc:test',
  handle: 'test.bsky.social',
  accessJwt: jwt({ scope: 'com.atproto.access', exp: 4102444800 }),
  refreshJwt: jwt({ scope: 'com.atproto.refresh', exp: 4102444800 }),
};

describe('BlueskyAdapter.createPost', () => {
  beforeEach(() => {
    net.calls.length = 0;
  });

  it('ログイン後に URL のファセット付きで投稿を作成する', async () => {
    net.setResponder((url) => {
      if (url.endsWith('/xrpc/com.atproto.server.createSession')) return json(session);
      if (url.endsWith('/xrpc/com.atproto.repo.createRecord'))
        return json({ uri: 'at://did:plc:test/app.bsky.feed.post/1', cid: 'bafyreibjo4xmgaevkgud7mbifn3dzp4v4lyaui4yvqp3f2bpwgzeeibl2e' });
      throw new Error(`unexpected request: ${url}`);
    });

    await new BlueskyAdapter('test.bsky.social', 'dummy').createPost({ url: 'https://example.com/a', title: 'example', note: null });

    expect(net.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/xrpc/com.atproto.server.createSession',
      '/xrpc/com.atproto.repo.createRecord',
    ]);
    expect(net.calls.every((c) => new URL(c.url).origin === 'https://bsky.social')).toBe(true);
    const record = net.calls[1].body as { collection: string; record: { text: string; facets: unknown[] } };
    expect(record.collection).toBe('app.bsky.feed.post');
    expect(record.record.text).toBe('🔖 "example" https://example.com/a');
    expect(record.record.facets).toEqual([
      {
        index: { byteStart: Buffer.byteLength('🔖 "example" '), byteEnd: Buffer.byteLength('🔖 "example" https://example.com/a') },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/a' }],
      },
    ]);
  });

  it('ログインがエラー応答のときは failed to post to Bluesky で失敗し、投稿を作らない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    net.setResponder(() => json({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }, 401));

    await expect(
      new BlueskyAdapter('test.bsky.social', 'dummy').createPost({ url: 'https://example.com', title: 't', note: null }),
    ).rejects.toThrow('failed to post to Bluesky');
    expect(net.calls.map((c) => new URL(c.url).pathname)).toEqual(['/xrpc/com.atproto.server.createSession']);
  });

  it('投稿作成がエラー応答のときは failed to post to Bluesky で失敗する', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    net.setResponder((url) =>
      url.endsWith('/xrpc/com.atproto.server.createSession')
        ? json(session)
        : json({ error: 'InvalidRequest', message: 'bad record' }, 400),
    );

    await expect(
      new BlueskyAdapter('test.bsky.social', 'dummy').createPost({ url: 'https://example.com', title: 't', note: null }),
    ).rejects.toThrow('failed to post to Bluesky');
  });
});
