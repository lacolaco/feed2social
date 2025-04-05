import { AtpAgent, RichText } from '@atproto/api';
import { PostData, SocialNetworkAdapter } from '../models';

const bsky = new AtpAgent({ service: 'https://bsky.social' });

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

      const text = `${post.note ?? '🔖'} "${post.title}" ${post.url}`;
      const rt = new RichText({ text });
      await rt.detectFacets(bsky);

      await bsky.post({ text: rt.text, facets: rt.facets });
    } catch (error) {
      console.error('Error posting to Bluesky:', error);
      throw new Error(`failed to post to Bluesky`, { cause: error });
    }
  }
}
