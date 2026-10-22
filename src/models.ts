export type FeedItem = {
  notionPageId: string;
  notionPageTitle: string;
  completedNetworkKeys: Set<string>;
  feedUrl: string;
  // Notion に保存されている URL。feedUrl と異なるときだけ書き戻す。
  notionUrl: string;
};

export type PostData = {
  title: string;
  url: string;
  note: string | null;
};

export interface SocialNetworkAdapter {
  getNetworkKey(): string;
  createPost(post: PostData): Promise<void>;
}
