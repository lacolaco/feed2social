import * as Encoding from 'encoding-japanese';

/**
 * HTTPレスポンスヘッダーからcharsetを検出します。
 * @param response - fetch APIのレスポンスオブジェクト
 * @returns 検出されたcharset（小文字）、見つからない場合はnull
 */
export function detectCharsetFromHeader(response: Response): string | null {
  const contentType = response.headers.get('content-type');
  if (!contentType) return null;

  const charsetMatch = contentType.match(/charset=([^;,\s]+)/i);
  return charsetMatch ? charsetMatch[1].toLowerCase() : null;
}

/**
 * HTMLコンテンツからcharsetを検出します。
 * @param bytes - HTMLのバイト配列
 * @returns 検出されたcharset（小文字）、見つからない場合はnull
 */
export function detectCharsetFromHtml(bytes: Uint8Array): string | null {
  // 最初の1024バイトをUTF-8として読み取り、メタタグを探す
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const htmlStart = decoder.decode(bytes.slice(0, Math.min(1024, bytes.length)));

  // <meta charset="..."> パターン
  const charsetMatch = htmlStart.match(/<meta[^>]+charset\s*=\s*['""]([^'"">\s]+)[^>]*>/i);
  if (charsetMatch) {
    return charsetMatch[1].toLowerCase();
  }

  // <meta http-equiv="Content-Type" content="text/html; charset=..."> パターン
  const httpEquivMatch = htmlStart.match(
    /<meta[^>]+http-equiv\s*=\s*['""]content-type['""][^>]+content\s*=\s*['""][^'"">]*charset=([^'"";,\s]+)[^>]*>/i,
  );
  if (httpEquivMatch) {
    return httpEquivMatch[1].toLowerCase();
  }

  return null;
}

/**
 * charset名をencoding-japanese用に正規化します。
 * @param charset - 正規化するcharset名
 * @returns encoding-japaneseで使用できるcharset名またはnull
 */
export function normalizeCharsetForEncoding(charset: string): Encoding.Encoding | null {
  const normalized = charset.toLowerCase().replace(/[-_]/g, '');

  // encoding-japanese用に正規化
  switch (normalized) {
    case 'shiftjis':
    case 'shift_jis':
    case 'sjis':
    case 'mskanji':
    case 'windows31j':
      return 'SJIS';
    case 'eucjp':
    case 'euc_jp':
      return 'EUCJP';
    case 'iso2022jp':
    case 'iso_2022_jp':
      return 'JIS';
    case 'utf8':
      return 'UTF8';
    case 'utf16':
    case 'utf16le':
      return 'UTF16';
    default:
      return null; // 対応していない場合はnull
  }
}

/**
 * バイト配列を適切な文字エンコーディングでデコードしてHTML文字列に変換します。
 * @param bytes - HTMLのバイト配列
 * @param response - fetch APIのレスポンスオブジェクト（ヘッダー情報取得用）
 * @returns デコードされたHTML文字列
 */
export function decodeHtmlBytes(bytes: Uint8Array, response: Response): string {
  try {
    // charsetを検出（HTTPヘッダー → HTMLメタタグ → UTF-8フォールバック）
    const detectedCharset = detectCharsetFromHeader(response) || detectCharsetFromHtml(bytes) || 'utf-8';

    // charset名をencoding-japanese用に正規化
    const encodingCharset = normalizeCharsetForEncoding(detectedCharset);

    // encoding-japaneseは配列として処理
    const byteArray = Array.from(bytes);
    const autoDetectedEncoding = Encoding.detect(byteArray);
    // 明示的指定 → 自動検出 → デフォルトの優先順位
    const finalCharset = encodingCharset || autoDetectedEncoding || 'UTF8';

    // encoding-japaneseがサポートするエンコーディングの場合のみ変換
    if (finalCharset) {
      const unicodeArray = Encoding.convert(byteArray, {
        to: 'UNICODE',
        from: finalCharset,
      });

      return Encoding.codeToString(unicodeArray);
    } else {
      // encoding-japaneseで対応していない場合はTextDecoderにフォールバック
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(bytes);
    }
  } catch (error) {
    // encoding-japaneseでエラーが発生した場合はUTF-8でフォールバック
    console.warn(`Encoding detection/conversion failed, falling back to UTF-8:`, error);
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  }
}

if (import.meta.vitest) {
  const { describe, test, expect } = import.meta.vitest;

  describe('encoding module', () => {
    test('should decode Shift-JIS content correctly', () => {
      const htmlContent = `
        <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">
          <title>テストタイトル Shift-JIS</title>
        </head>
        </html>
      `;

      // encoding-japaneseを使ってShift-JISエンコード
      const sjisArray = Encoding.convert(Encoding.stringToCode(htmlContent), {
        to: 'SJIS',
        from: 'UNICODE',
      });

      const mockResponse = {
        headers: {
          get: () => null,
        },
      } as unknown as Response;

      const bytes = new Uint8Array(sjisArray);
      const decodedHtml = decodeHtmlBytes(bytes, mockResponse);

      expect(decodedHtml).toContain('テストタイトル Shift-JIS');
    });

    test('should decode EUC-JP content correctly', () => {
      const htmlContent = `
        <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">
          <title>テストタイトル EUC-JP</title>
        </head>
        </html>
      `;

      // encoding-japaneseを使ってEUC-JPエンコード
      const eucjpArray = Encoding.convert(Encoding.stringToCode(htmlContent), {
        to: 'EUCJP',
        from: 'UNICODE',
      });

      const mockResponse = {
        headers: {
          get: () => null,
        },
      } as unknown as Response;

      const bytes = new Uint8Array(eucjpArray);
      const decodedHtml = decodeHtmlBytes(bytes, mockResponse);

      expect(decodedHtml).toContain('テストタイトル EUC-JP');
    });

    test('should use charset from HTTP headers', () => {
      const htmlContent = '<title>HTTPヘッダーテスト</title>';
      const bytes = new TextEncoder().encode(htmlContent);

      const mockResponse = {
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html; charset=utf-8' : null),
        },
      } as unknown as Response;

      const decodedHtml = decodeHtmlBytes(bytes, mockResponse);

      expect(decodedHtml).toContain('HTTPヘッダーテスト');
    });

    test('should detect charset from HTML meta tag', () => {
      const htmlWithMetaCharset = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>メタタグテスト</title>
        </head>
        </html>
      `;

      const bytes = new TextEncoder().encode(htmlWithMetaCharset);
      const detectedCharset = detectCharsetFromHtml(bytes);

      expect(detectedCharset).toBe('utf-8');
    });

    test('should detect charset from HTTP-equiv meta tag', () => {
      const htmlWithHttpEquiv = `
        <meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">
      `;

      const bytes = new TextEncoder().encode(htmlWithHttpEquiv);
      const detectedCharset = detectCharsetFromHtml(bytes);

      expect(detectedCharset).toBe('shift_jis');
    });

    test('should detect charset from HTTP header', () => {
      const mockResponse = {
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html; charset=EUC-JP' : null),
        },
      } as unknown as Response;

      const detectedCharset = detectCharsetFromHeader(mockResponse);

      expect(detectedCharset).toBe('euc-jp');
    });

    test('should normalize charset for encoding-japanese', () => {
      expect(normalizeCharsetForEncoding('shift_jis')).toBe('SJIS');
      expect(normalizeCharsetForEncoding('Shift-JIS')).toBe('SJIS');
      expect(normalizeCharsetForEncoding('sjis')).toBe('SJIS');
      expect(normalizeCharsetForEncoding('euc-jp')).toBe('EUCJP');
      expect(normalizeCharsetForEncoding('UTF-8')).toBe('UTF8');
      expect(normalizeCharsetForEncoding('unknown')).toBe(null);
    });
  });
}
