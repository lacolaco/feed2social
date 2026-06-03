import { AtpAgent, RichText } from '@atproto/api';
import { PostData, SocialNetworkAdapter } from '../models';

const BLUESKY_MAX_GRAPHEMES = 300;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): string[] {
  return [...SEGMENTER.segment(text)].map((s) => s.segment);
}

const bsky = new AtpAgent({ service: 'https://bsky.social' });

export function buildText(post: PostData): string {
  const prefix = post.note ?? '🔖';
  const url = post.url;
  // Fixed framing: `${prefix} "${title}" ${url}` — anything outside `title` is required.
  const framingGraphemes = graphemes(prefix).length + graphemes(' "" ').length + graphemes(url).length;
  const titleBudget = BLUESKY_MAX_GRAPHEMES - framingGraphemes;
  const titleGr = graphemes(post.title);
  const title = titleGr.length <= titleBudget ? post.title : titleGr.slice(0, Math.max(0, titleBudget - 1)).join('') + '…';
  return `${prefix} "${title}" ${url}`;
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
      expect(text).toContain('a'.repeat(100));
    });

    it('300 grapheme を超える日本語 title は title 内容を保持したまま 300 以下に切り詰める', () => {
      const longTitle = 'あ'.repeat(400);
      const text = buildText({
        url: 'https://example.com',
        title: longTitle,
        note: null,
      });
      expect(countGraphemes(text)).toBeLessThanOrEqual(300);
      expect(text).toContain('https://example.com');
      // title must not be silently emptied to `""`
      expect(text).toMatch(/"あ+…"/);
      // title budget = 300 − framing(≈30) ≈ 270 → at least 200 graphemes of title survive
      expect((text.match(/あ/g) ?? []).length).toBeGreaterThan(200);
    });

    it('複合絵文字 (ZWJ シーケンス) で truncation 境界が cluster を割らない', () => {
      // 👨‍👩‍👧 は ZWJ シーケンスで 1 grapheme だが 8 code units
      // 400 シーケンス = 400 graphemes、framing と合わせて 300 を超える
      const text = buildText({
        url: 'https://example.com',
        title: '👨‍👩‍👧'.repeat(400),
        note: null,
      });
      expect(countGraphemes(text)).toBeLessThanOrEqual(300);
      // truncation must end on a complete cluster + ellipsis, never on a partial ZWJ
      expect(text).toMatch(/👨‍👩‍👧…/);
      // no orphan high surrogate at the cut
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          expect(text.charCodeAt(i + 1)).toBeGreaterThanOrEqual(0xdc00);
          expect(text.charCodeAt(i + 1)).toBeLessThanOrEqual(0xdfff);
        }
      }
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
