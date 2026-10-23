// Well-known tracking query parameters. Conservative list — start minimal.
// 拡張する場合はサイト別の誤検出に注意（特に `ref` / `source` は除外している）。
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  // Google Ads / Analytics
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  '_ga',
  '_gl',
  // Facebook
  'fbclid',
  // Instagram
  'igshid',
  'igsh',
  // Mailchimp
  'mc_cid',
  'mc_eid',
  // Microsoft Ads
  'msclkid',
  // Twitter / Yandex / TikTok
  'twclid',
  'yclid',
  'ttclid',
]);

// `utm_mediun` のような綴り間違いも除去するため、UTM は完全一致の一覧ではなく前方一致で判定する。
const UTM_PREFIX = 'utm_';

function isTrackingParam(key: string): boolean {
  return key.toLowerCase().startsWith(UTM_PREFIX) || TRACKING_PARAMS.has(key.toLowerCase());
}

function decodeKey(pair: string): string {
  const key = pair.split('=')[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

// 残すパラメータの表記を変えないため、URLSearchParams で再直列化せず、クエリを `&` で分けた要素のうち除去するものだけを取り除く。
export function sanitizeTrackingParams(input: string): string {
  try {
    new URL(input);
  } catch {
    return input;
  }

  const hashIndex = input.indexOf('#');
  const beforeHash = hashIndex === -1 ? input : input.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : input.slice(hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  if (queryIndex === -1) {
    return input;
  }
  const base = beforeHash.slice(0, queryIndex);
  const pairs = beforeHash.slice(queryIndex + 1).split('&');
  const kept = pairs.filter((pair) => !isTrackingParam(decodeKey(pair)));
  if (kept.length === pairs.length) {
    return input;
  }
  return `${base}${kept.length > 0 ? `?${kept.join('&')}` : ''}${hash}`;
}

if (import.meta.vitest) {
  const { describe, test, expect } = import.meta.vitest;

  describe('sanitizeTrackingParams', () => {
    test('returns input as-is when there are no query params', () => {
      expect(sanitizeTrackingParams('https://example.com/path')).toBe('https://example.com/path');
    });

    test('returns input as-is when no tracking params are present', () => {
      expect(sanitizeTrackingParams('https://example.com/?q=foo&page=2')).toBe('https://example.com/?q=foo&page=2');
    });

    test('removes utm_* params', () => {
      const input = 'https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=spring';
      expect(sanitizeTrackingParams(input)).toBe('https://example.com/article');
    });

    test('removes utm_ params case-insensitively, including misspelled names', () => {
      expect(sanitizeTrackingParams('https://www.oreilly.co.jp/books/9784814401789/?utm_mediun=referral')).toBe(
        'https://www.oreilly.co.jp/books/9784814401789/',
      );
      expect(sanitizeTrackingParams('https://example.com/a?UTM_Source=x&q=1#top')).toBe('https://example.com/a?q=1#top');
    });

    test('keeps the remaining query exactly as written', () => {
      expect(sanitizeTrackingParams('https://example.com/?q=a%20b&utm_source=x')).toBe('https://example.com/?q=a%20b');
      expect(sanitizeTrackingParams('https://example.com/?a=1;b=2&utm_source=x')).toBe('https://example.com/?a=1;b=2');
      expect(sanitizeTrackingParams('https://example.com/?id&utm_x=1')).toBe('https://example.com/?id');
      expect(sanitizeTrackingParams('https://example.com/?q=a~b(c)*&utm_x=1')).toBe('https://example.com/?q=a~b(c)*');
    });

    test('removes a percent-encoded utm_ key', () => {
      expect(sanitizeTrackingParams('https://example.com/?utm%5Fsource=x&q=1')).toBe('https://example.com/?q=1');
    });

    test('removes gclid and fbclid', () => {
      expect(sanitizeTrackingParams('https://example.com/?gclid=abc')).toBe('https://example.com/');
      expect(sanitizeTrackingParams('https://example.com/?fbclid=xyz')).toBe('https://example.com/');
    });

    test.each([
      'igshid',
      'igsh',
      'mc_cid',
      'mc_eid',
      'msclkid',
      'twclid',
      'yclid',
      'ttclid',
      'dclid',
      'gbraid',
      'wbraid',
      '_ga',
      '_gl',
      'GCLID',
      'FbClid',
    ])('removes %s while keeping the other params as written', (name) => {
      expect(sanitizeTrackingParams(`https://example.com/?q=a%20b&${name}=1&z=2#top`)).toBe('https://example.com/?q=a%20b&z=2#top');
      expect(sanitizeTrackingParams(`https://example.com/?${name}=1`)).toBe('https://example.com/');
    });

    test('keeps params that only resemble the removed names', () => {
      const input = 'https://example.com/?si=abc&igsh2=1&ga=1&gl=jp';
      expect(sanitizeTrackingParams(input)).toBe(input);
    });

    test('keeps legitimate params while stripping tracking params', () => {
      const input = 'https://example.com/search?q=feed2social&utm_source=twitter&page=2';
      const result = sanitizeTrackingParams(input);
      const url = new URL(result);
      expect(url.searchParams.get('q')).toBe('feed2social');
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.has('utm_source')).toBe(false);
    });

    test('preserves fragment', () => {
      expect(sanitizeTrackingParams('https://example.com/doc?utm_source=foo#section-2')).toBe('https://example.com/doc#section-2');
    });

    test('preserves path, scheme, host, and port', () => {
      expect(sanitizeTrackingParams('http://example.com:8080/a/b?utm_id=x')).toBe('http://example.com:8080/a/b');
    });

    test('returns input as-is when URL is not parseable', () => {
      expect(sanitizeTrackingParams('not a url')).toBe('not a url');
    });

    test('returns empty string as-is', () => {
      expect(sanitizeTrackingParams('')).toBe('');
    });
  });
}
