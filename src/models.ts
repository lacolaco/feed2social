import { z } from 'zod';

export type FeedItem = {
  notionBlockId: string;
  title: string;
  url: string;
  note?: string;
};

export interface SocialPostSender {
  sendPost(item: FeedItem): Promise<void>;
  buildPost(item: FeedItem): PostObject;
}

export const PostDistribution = z.enum(['twitter', 'misskey', 'bluesky']);
export type PostDistribution = z.infer<typeof PostDistribution>;

export const PostObject = z.object({
  distribution: PostDistribution,
  text: z.string(),
});
export type PostObject = z.infer<typeof PostObject>;

export const CreatePostReq = z.object({
  data: z.array(PostObject),
});
export type CreatePostReq = z.infer<typeof CreatePostReq>;
