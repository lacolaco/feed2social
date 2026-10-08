export type TwitterBreakerState = { kind: 'closed' } | { kind: 'open'; openedAt: string; nextRetryAt: string } | { kind: 'unavailable' };

const RETRY_MS = 60 * 60 * 1000;

export function canAttemptTwitter(state: TwitterBreakerState, now: Date): boolean {
  return state.kind === 'closed' || (state.kind === 'open' && now >= new Date(state.nextRetryAt));
}

export function creditsDepleted(state: TwitterBreakerState, now: Date) {
  return {
    state: {
      kind: 'open' as const,
      openedAt: state.kind === 'open' ? state.openedAt : now.toISOString(),
      nextRetryAt: new Date(now.getTime() + RETRY_MS).toISOString(),
    },
    notify: state.kind === 'closed',
  };
}

export function twitterRecovered(state: TwitterBreakerState) {
  return { state: { kind: 'closed' as const }, notify: state.kind === 'open' };
}
