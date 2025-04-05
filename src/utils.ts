import { load } from 'cheerio';

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
      'accept-charset': 'utf-8',
    },
  });
  const html = await resp.text();
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
