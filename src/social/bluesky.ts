import { AtpAgent, RichText } from '@atproto/api';
import { truncate } from 'tweet-truncator';
import { PostData, SocialNetworkAdapter } from '../models';

const BLUESKY_MAX_GRAPHEMES = 300;

const bsky = new AtpAgent({ service: 'https://bsky.social' });

export function buildText(post: PostData): string {
  const truncated = truncate(
    { desc: post.note ?? '', title: post.title, url: post.url },
    {
      defaultPrefix: '🔖',
      template: '%desc% "%title%" %url%',
      truncatedOrder: ['title', 'desc'],
      maxLength: BLUESKY_MAX_GRAPHEMES,
    },
  );
  // tweet-truncator uses twitter-text weighted counts (URL=23, emoji=2),
  // which differ from Bluesky's grapheme count. Enforce the real limit here.
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = [...segmenter.segment(truncated)].map((s) => s.segment);
  if (graphemes.length <= BLUESKY_MAX_GRAPHEMES) return truncated;
  return graphemes.slice(0, BLUESKY_MAX_GRAPHEMES - 1).join('') + '…';
}

export class BlueskyAdapter implements SocialNetworkAdapter {
  constructor(
    private readonly id: string,
    private readonly password: string,
  ) {}

  getNetworkKey(): string {
    return 'bluesky';
  }

  async createPost(post: PostData): Promise<void> {
    try {
      await bsky.login({ identifier: this.id, password: this.password });

      const text = buildText(post);
      const rt = new RichText({ text });
      await rt.detectFacets(bsky);

      await bsky.post({ text: rt.text, facets: rt.facets });
    } catch (error) {
      console.error('Error posting to Bluesky:', error);
      throw new Error(`failed to post to Bluesky`, { cause: error });
    }
  }
}

// in-source test suites
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const countGraphemes = (text: string) => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(text)].length;
  };

  describe('buildText', () => {
    it('note なしのときは prefix 絵文字を付ける', () => {
      const text = buildText({
        url: 'https://example.com',
        title: 'example',
        note: null,
      });
      expect(text).toBe('🔖 "example" https://example.com');
    });

    it('note ありのときは note を使う', () => {
      const text = buildText({
        url: 'https://example.com',
        title: 'example',
        note: 'note',
      });
      expect(text).toBe('note "example" https://example.com');
    });

    it('300 grapheme 以内ならそのまま返る', () => {
      const text = buildText({
        url: 'https://example.com',
        title: 'a'.repeat(100),
        note: null,
      });
      expect(countGraphemes(text)).toBeLessThanOrEqual(300);
      expect(text).toContain('https://example.com');
    });

    it('300 grapheme を超える日本語 title は 300 以下に切り詰める', () => {
      const longTitle = 'あ'.repeat(400);
      const text = buildText({
        url: 'https://example.com',
        title: longTitle,
        note: null,
      });
      expect(countGraphemes(text)).toBeLessThanOrEqual(300);
      expect(text).toContain('https://example.com');
    });

    it('複合絵文字 (ZWJ シーケンス) を grapheme で正しく数える', () => {
      // 👨‍👩‍👧 は ZWJ シーケンスで 1 grapheme だが複数 code points
      const text = buildText({
        url: 'https://example.com',
        title: '👨‍👩‍👧'.repeat(200),
        note: null,
      });
      expect(countGraphemes(text)).toBeLessThanOrEqual(300);
      expect(text).toContain('https://example.com');
    });

    it('IRON-WORKER-16 の症状 (348 graphemes) を再現せず 300 以下にする', () => {
      const text = buildText({
        url: 'https://example.com/very/long/url/path/here',
        title: 'これは非常に長いタイトルでして'.repeat(30),
        note: 'これは note です'.repeat(20),
      });
      expect(countGraphemes(text)).toBeLessThanOrEqual(300);
    });
  });
}
