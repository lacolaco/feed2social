// Well-known tracking query parameters. Conservative list — start minimal.
// 拡張する場合はサイト別の誤検出に注意（特に `ref` / `source` は除外している）。
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  // Google Analytics / UTM
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  // Google Ads
  'gclid',
  // Facebook
  'fbclid',
]);

export function sanitizeTrackingParams(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }

  let mutated = false;
  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING_PARAMS.has(key)) {
      url.searchParams.delete(key);
      mutated = true;
    }
  }
  if (!mutated) {
    return input;
  }
  return url.toString();
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

    test('removes gclid and fbclid', () => {
      expect(sanitizeTrackingParams('https://example.com/?gclid=abc')).toBe('https://example.com/');
      expect(sanitizeTrackingParams('https://example.com/?fbclid=xyz')).toBe('https://example.com/');
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
