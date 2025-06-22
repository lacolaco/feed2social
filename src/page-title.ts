import { load } from 'cheerio';
import { decodeHtmlBytes } from './encoding';

/**
 * 指定されたURLからウェブページのタイトルを取得します。
 *
 * この関数は指定されたURLにHTTP GETリクエストを送り、ページタイトルを抽出しようとします。
 * まず、Open Graphメタデータとして一般的に使用される`og:title`メタタグを探します。
 * `og:title`が見つからない場合は、HTMLドキュメント内の`<title>`要素の内容を使用します。
 * どちらも見つからない場合は、空の文字列を返します。
 *
 * @param url - タイトルを取得するウェブページのURL。
 * @returns ページタイトルを文字列として解決するPromise。タイトルが見つからない場合は空の文字列を返します。
 *
 * @throws フェッチリクエストが失敗した場合、またはレスポンスをテキストとして解析できない場合にエラーをスローします。
 */
export async function fetchPageTitle(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'user-agent': 'feed2social',
      accept: 'text/html',
    },
  });

  // バイナリデータとして取得してデコード
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const html = decodeHtmlBytes(bytes, resp);

  const $ = load(html);
  // search title from og:title
  const ogTitle = $('meta[property="og:title"]').attr('content');
  if (ogTitle) {
    return ogTitle;
  }
  // search title from <title>
  const title = $('title').text();
  if (title) {
    return title;
  }

  return '';
}

if (import.meta.vitest) {
  const { describe, test, expect } = import.meta.vitest;
  const Encoding = await import('encoding-japanese');

  describe('fetchPageTitle charset detection', () => {
    test('should handle UTF-8 charset correctly', async () => {
      // UTF-8のHTMLをモック
      const utf8Html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>テストタイトル UTF-8</title>
        </head>
        <body></body>
        </html>
      `;

      // fetch APIをモック
      const mockFetch = async () => ({
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html; charset=utf-8' : null),
        },
        arrayBuffer: async () => new TextEncoder().encode(utf8Html).buffer,
      });

      // global fetchを一時的に置き換え
      const originalFetch = global.fetch;
      global.fetch = mockFetch as any;

      try {
        const title = await fetchPageTitle('https://example.com');
        expect(title).toBe('テストタイトル UTF-8');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('should detect charset from meta tag with encoding-japanese', async () => {
      // Shift-JISのHTMLを実際にShift-JISでエンコード
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">
          <title>テストタイトル Shift-JIS</title>
        </head>
        <body></body>
        </html>
      `;

      // encoding-japaneseを使ってShift-JISエンコード
      const sjisArray = Encoding.convert(Encoding.stringToCode(htmlContent), {
        to: 'SJIS',
        from: 'UNICODE',
      });

      const mockFetch = async () => ({
        headers: {
          get: () => null, // HTTPヘッダーにcharsetなし
        },
        arrayBuffer: async () => new Uint8Array(sjisArray).buffer,
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch as any;

      try {
        const title = await fetchPageTitle('https://example.com');
        expect(title).toBe('テストタイトル Shift-JIS');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('should handle og:title over regular title', async () => {
      const htmlWithOgTitle = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta property="og:title" content="OGタイトル">
          <title>通常のタイトル</title>
        </head>
        <body></body>
        </html>
      `;

      const mockFetch = async () => ({
        headers: {
          get: () => null,
        },
        arrayBuffer: async () => new TextEncoder().encode(htmlWithOgTitle).buffer,
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch as any;

      try {
        const title = await fetchPageTitle('https://example.com');
        expect(title).toBe('OGタイトル');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('should fallback to UTF-8 when charset detection fails', async () => {
      const htmlWithoutCharset = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>フォールバックテスト</title>
        </head>
        <body></body>
        </html>
      `;

      const mockFetch = async () => ({
        headers: {
          get: () => null,
        },
        arrayBuffer: async () => new TextEncoder().encode(htmlWithoutCharset).buffer,
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch as any;

      try {
        const title = await fetchPageTitle('https://example.com');
        expect(title).toBe('フォールバックテスト');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('integration tests', () => {
    test('should fetch actual Japanese page title correctly', async () => {
      const url = 'https://user.keio.ac.jp/~rhotta/hellog/2025-06-21-1.html';
      const expectedTitle = '#5899. 「クレイフィッシュ語」？ --- ヘルメイトさんたちによる用語開発';

      // 実際のHTTPリクエストでテスト
      const title = await fetchPageTitle(url);

      expect(title).toBe(expectedTitle);
    }, 10000); // ネットワーク遅延対応のため10秒タイムアウト
  });
}
