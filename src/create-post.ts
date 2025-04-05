import leven from 'leven';
import { FeedItem, PostData } from './models';
import { fetchPageTitle } from './utils';

export async function createPostData(item: FeedItem): Promise<PostData> {
  const { notionPageTitle, feedUrl } = item;
  const title = await fetchPageTitle(feedUrl);
  // Notionページタイトルがページタイトルと異なる場合は、ノートとして表示する
  // TODO: 内容の同一性の確認にGeminiを使用する
  const note = leven(title, notionPageTitle) > 5 ? notionPageTitle : null;

  return { url: feedUrl, title, note };
}
