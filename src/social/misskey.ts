import { PostData, SocialNetworkAdapter } from '../models';

export class MisskeyAdapter implements SocialNetworkAdapter {
  constructor(private readonly token: string) {}

  getNetworkKey(): string {
    return 'misskey';
  }

  /**
   * @see https://misskey-hub.net/docs/api/endpoints/notes/create.html
   */
  async createPost(post: PostData): Promise<void> {
    const text = `${post.note ?? '🔖'} "${post.title}" ${post.url} #laco_feed`;
    await fetch('https://misskey.io/api/notes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, i: this.token }),
    });
  }
}
