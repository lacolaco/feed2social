import leven from 'leven';
import { FeedItem, PostData } from './models';
import { fetchPageTitle } from './page-title';

export async function createPostData(item: FeedItem): Promise<PostData> {
  const { notionPageTitle, feedUrl } = item;
  const title = await fetchPageTitle(feedUrl);

  // Webページタイトルが取得できなかった場合は、Notionページタイトルを使用する
  if (title === '') {
    return { url: feedUrl, title: notionPageTitle, note: null };
  }

  // NotionページタイトルがWebページタイトルと異なる場合は、ノートとして表示する
  const note = isSimilar(title, notionPageTitle) ? null : notionPageTitle;
  return { url: feedUrl, title, note };
}

// TODO: 内容の同一性の確認にGeminiを使用する
function isSimilar(a: string, b: string): boolean {
  // 一方の文字列が他方の文字列に含まれている場合は、類似しているとみなす
  if (a.includes(b) || b.includes(a)) {
    return true;
  }
  // レーベンシュタイン距離が、長い方の文字列の半分以上であれば、類似していないとみなす
  return leven(a, b) < Math.min(a.length, b.length) / 2;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;

  test('isSimilar', () => {
    expect(isSimilar('abc', 'abc')).toBe(true);
    expect(isSimilar('abc', 'ab')).toBe(true);
    expect(isSimilar('abc', 'a')).toBe(true);
    expect(isSimilar('abc', 'abcd')).toBe(true);
    expect(isSimilar('ab1c', 'ab9c')).toBe(true);
    expect(isSimilar('ab12c', 'ab98c')).toBe(true);
    expect(isSimilar('abc123', 'abc987')).toBe(false);
  });
}
