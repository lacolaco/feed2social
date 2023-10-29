import { FeedItem, SocialPostSender } from '../models';

export class MisskeyPostSender implements SocialPostSender {
  constructor(private readonly token: string) {}

  /**
   * @see https://misskey-hub.net/docs/api/endpoints/notes/create.html
   */
  async sendPost(item: FeedItem): Promise<void> {
    const text = `${item.note ?? '🔖'} "${item.title}" ${item.url} #laco_feed`;
    await fetch('https://misskey.io/api/notes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, i: this.token }),
    });
  }
}
