import { load } from 'cheerio';

export async function fetchPageTitle(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { accept: 'text/html', 'user-agent': 'feed2social' } });
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
