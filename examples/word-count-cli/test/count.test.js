import { test } from 'node:test';
import assert from 'node:assert/strict';
import countText from '../src/count.js';
import { countText as namedCountText } from '../src/count.js';

test('empty string', () => {
  const r = countText('');
  assert.equal(r.bytes, 0);
  assert.equal(r.lines, 0);
  assert.equal(r.words, 0);
  assert.equal(r.chars, 0);
  assert.equal(r.cjkChars, undefined);
  assert.equal(r.cjkWords, undefined);
});

test('pure English', () => {
  const r = countText('hello world');
  assert.equal(r.bytes, 11);
  assert.equal(r.lines, 0);
  assert.equal(r.words, 2);
  assert.equal(r.chars, 11);
});

test('pure Chinese', () => {
  const r = countText('你好世界');
  assert.equal(r.bytes, 12);
  assert.equal(r.lines, 0);
  assert.equal(r.words, 1); // no whitespace => one "word"
  assert.equal(r.chars, 4);
});

test('mixed English and Chinese', () => {
  const r = countText('hello 你好 world');
  assert.equal(r.bytes, Buffer.byteLength('hello 你好 world', 'utf8'));
  assert.equal(r.words, 3);
  assert.equal(r.chars, 14);
});

test('multi-line text', () => {
  const r = countText('one\ntwo\nthree');
  assert.equal(r.lines, 2);
  assert.equal(r.words, 3);
  assert.equal(r.chars, 13);
  assert.equal(r.bytes, 13);
});

test('trailing newline counts as one line (wc -l semantics)', () => {
  const r = countText('one\ntwo\n');
  assert.equal(r.lines, 2);
});

test('emoji counts as one code point for chars', () => {
  const r = countText('a🙂b');
  assert.equal(r.chars, 3); // 🙂 is a single code point (surrogate pair in UTF-16)
  assert.equal(r.bytes, 1 + 4 + 1);
  assert.equal(r.words, 1);
});

test('zh option off: no cjk fields', () => {
  const r = countText('你好 world');
  assert.equal(r.cjkChars, undefined);
  assert.equal(r.cjkWords, undefined);
});

test('zh option explicitly false: no cjk fields', () => {
  const r = countText('你好 world', { zh: false });
  assert.equal(r.cjkChars, undefined);
  assert.equal(r.cjkWords, undefined);
});

test('zh option on: cjkChars and cjkWords', () => {
  const r = countText('你好 world', { zh: true });
  assert.equal(r.words, 2);
  assert.equal(r.cjkChars, 2);
  assert.equal(r.cjkWords, 3); // 非中文词 1（"world"）+ cjkChars 2
});

test('zh option on: CJK extension A characters counted', () => {
  const r = countText('㐀㐁', { zh: true });
  assert.equal(r.cjkChars, 2);
  assert.equal(r.chars, 2);
  assert.equal(r.cjkWords, 2); // 非中文词 0 + cjkChars 2（连续汉字段不被双重计数）
});

test('zh option on: no CJK present', () => {
  const r = countText('hello world', { zh: true });
  assert.equal(r.cjkChars, 0);
  assert.equal(r.cjkWords, 2);
});

test('CRLF line endings', () => {
  const r = countText('one\r\ntwo\r\nthree');
  assert.equal(r.lines, 2);
  assert.equal(r.words, 3);
  assert.equal(r.bytes, 15);
});

test('default and named exports are the same function', () => {
  assert.equal(namedCountText, countText);
});
