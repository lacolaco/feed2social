import { BskyAgent, RichText } from '@atproto/api';
import { FeedItem, SocialPostSender } from '../models';

const bsky = new BskyAgent({ service: 'https://bsky.social' });

export class BlueskyPostSender implements SocialPostSender {
  constructor(
    private readonly id: string,
    private readonly password: string,
  ) {}

  async sendPost(item: FeedItem): Promise<void> {
    await bsky.login({ identifier: this.id, password: this.password });

    const text = `${item.note ?? '🔖'} "${item.title}" ${item.url}`;
    const rt = new RichText({ text });
    await rt.detectFacets(bsky);

    await bsky.post({ text: rt.text, facets: rt.facets });
  }

  buildPost(item: FeedItem) {
    return {
      distribution: 'bluesky' as const,
      text: `${item.note ?? '🔖'} "${item.title}" ${item.url}`,
    };
  }
}
