const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInput, isUrlLike, hostnameOf, isSecure } = require('../src/renderer/url-utils.js');

const GOOGLE = 'https://www.google.com/search?q=%s';

test('عناوين كاملة تبقى كما هي', () => {
  assert.equal(normalizeInput('https://example.com/a?b=1', GOOGLE).url, 'https://example.com/a?b=1');
  assert.equal(normalizeInput('http://example.com', GOOGLE).type, 'url');
});

test('نطاق بدون بروتوكول يصبح HTTPS', () => {
  assert.equal(normalizeInput('example.com', GOOGLE).url, 'https://example.com/');
  assert.equal(normalizeInput('sub.example.co.uk/path', GOOGLE).url, 'https://sub.example.co.uk/path');
});

test('المضيف المحلي وعناوين IP تستخدم HTTP', () => {
  assert.equal(normalizeInput('localhost:3000', GOOGLE).url, 'http://localhost:3000/');
  assert.equal(normalizeInput('192.168.1.10/admin', GOOGLE).url, 'http://192.168.1.10/admin');
});

test('عبارات البحث تذهب لمحرك البحث مع الترميز', () => {
  const r = normalizeInput('أخبار التقنية اليوم', GOOGLE);
  assert.equal(r.type, 'search');
  assert.ok(r.url.startsWith('https://www.google.com/search?q='));
  assert.ok(!r.url.includes(' '));
  assert.equal(normalizeInput('hello world', GOOGLE).type, 'search');
  assert.equal(normalizeInput('كلمةواحدة', GOOGLE).type, 'search');
});

test('الصفحة الرئيسية الداخلية', () => {
  assert.equal(normalizeInput('', GOOGLE).type, 'home');
  assert.equal(normalizeInput('nova://home', GOOGLE).type, 'home');
  assert.equal(normalizeInput('nova://start', GOOGLE).type, 'home');
});

test('isUrlLike', () => {
  assert.ok(isUrlLike('example.com'));
  assert.ok(isUrlLike('https://example.com'));
  assert.ok(isUrlLike('localhost:8080'));
  assert.ok(!isUrlLike('ابحث عن هذا'));
  assert.ok(!isUrlLike('example'));
  assert.ok(!isUrlLike(''));
});

test('hostnameOf و isSecure', () => {
  assert.equal(hostnameOf('https://ar.wikipedia.org/wiki/x'), 'ar.wikipedia.org');
  assert.equal(hostnameOf('not a url'), '');
  assert.ok(isSecure('https://example.com'));
  assert.ok(!isSecure('http://example.com'));
});
