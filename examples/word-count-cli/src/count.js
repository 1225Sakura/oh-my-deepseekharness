// CJK Unified Ideographs: -鿿, Extension A: 㐀-䶿
const CJK_PATTERN = /[一-鿿㐀-䶿]/g;

/**
 * Count text statistics.
 *
 * @param {string} text - Input text.
 * @param {{ zh?: boolean }} [opts] - Options. zh=true enables CJK counts.
 * @returns {{ bytes: number, lines: number, words: number, chars: number,
 *             cjkChars?: number, cjkWords?: number }}
 */
export function countText(text, opts = {}) {
  const bytes = Buffer.byteLength(text, 'utf8');
  // Match wc -l: number of '\n' characters; empty text => 0.
  const lines = text === '' ? 0 : (text.match(/\n/g) || []).length;
  const words = (text.match(/\S+/g) || []).length;
  const chars = [...text].length;

  const result = { bytes, lines, words, chars };

  if (opts.zh === true) {
    const cjkChars = (text.match(CJK_PATTERN) || []).length;
    // “每个 CJK 字计 1 词”：先把 CJK 字替换为空格再数非中文词，避免连续汉字段被双重计数。
    const nonCjkWords = (text.replace(CJK_PATTERN, ' ').match(/\S+/g) || []).length;
    result.cjkChars = cjkChars;
    result.cjkWords = nonCjkWords + cjkChars;
  }

  return result;
}

export default countText;
