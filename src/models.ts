export type FeedItem = {
  notionBlockId: string;
  title: string;
  url: string;
  note?: string;
};

export interface SocialPostSender {
  sendPost(item: FeedItem): Promise<void>;
}
