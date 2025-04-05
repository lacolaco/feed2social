export type FeedItem = {
  notionPageId: string;
  notionPageTitle: string;
  completedNetworkKeys: Set<string>;
  feedUrl: string;
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
