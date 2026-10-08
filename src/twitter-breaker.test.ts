import { describe, expect, it } from 'vitest';
import { canAttemptTwitter, creditsDepleted, twitterRecovered, type TwitterBreakerState } from './twitter-breaker';

const now = new Date('2026-10-08T01:00:00Z');
const open: TwitterBreakerState = {
  kind: 'open',
  openedAt: '2026-10-08T00:00:00.000Z',
  nextRetryAt: '2026-10-08T01:00:00.000Z',
};

describe('Twitter credits breaker decisions', () => {
  it('allows a closed breaker and a due retry, but suppresses early retries and unavailable storage', () => {
    expect(canAttemptTwitter({ kind: 'closed' }, now)).toBe(true);
    expect(canAttemptTwitter(open, now)).toBe(true);
    expect(canAttemptTwitter(open, new Date('2026-10-08T00:59:59Z'))).toBe(false);
    expect(canAttemptTwitter({ kind: 'unavailable' }, now)).toBe(false);
  });

  it('opens on first depletion and extends an existing breaker without another alert', () => {
    expect(creditsDepleted({ kind: 'closed' }, now)).toEqual({
      state: { kind: 'open', openedAt: now.toISOString(), nextRetryAt: '2026-10-08T02:00:00.000Z' },
      notify: true,
    });
    expect(creditsDepleted(open, now)).toEqual({
      state: { kind: 'open', openedAt: open.openedAt, nextRetryAt: '2026-10-08T02:00:00.000Z' },
      notify: false,
    });
  });

  it('marks recovery only for an open breaker', () => {
    expect(twitterRecovered(open)).toEqual({ state: { kind: 'closed' }, notify: true });
    expect(twitterRecovered({ kind: 'closed' })).toEqual({ state: { kind: 'closed' }, notify: false });
  });
});
