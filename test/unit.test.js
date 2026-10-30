const test = require('node:test');
const assert = require('node:assert');
const { parseVideoUrl } = require('../src/lib/video');
const { wordCount, parseLetterboxd } = require('../src/lib/text');

test('parses YouTube links in their common shapes', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    'https://youtu.be/aqz-KE-bpKQ?t=10',
    'https://m.youtube.com/watch?v=aqz-KE-bpKQ&list=x',
    'https://www.youtube.com/shorts/aqz-KE-bpKQ',
    'https://www.youtube.com/embed/aqz-KE-bpKQ',
  ]) {
    assert.deepStrictEqual(parseVideoUrl(url), { provider: 'youtube', id: 'aqz-KE-bpKQ' }, url);
  }
});

test('parses Vimeo links', () => {
  assert.deepStrictEqual(parseVideoUrl('https://vimeo.com/76979871'), { provider: 'vimeo', id: '76979871' });
  assert.deepStrictEqual(parseVideoUrl('https://vimeo.com/channels/staffpicks/76979871'), { provider: 'vimeo', id: '76979871' });
  assert.deepStrictEqual(parseVideoUrl('https://player.vimeo.com/video/76979871'), { provider: 'vimeo', id: '76979871' });
});

test('rejects anything that is not a YouTube or Vimeo video', () => {
  for (const url of ['', 'not a url', 'https://example.com/video/123456', 'javascript:alert(1)', 'https://youtube.com/watch?v=short', 'https://vimeo.com/about']) {
    assert.strictEqual(parseVideoUrl(url), null, url);
  }
});

test('counts words, ignoring punctuation and whitespace', () => {
  assert.strictEqual(wordCount(''), 0);
  assert.strictEqual(wordCount('  The DP’s light — warm,   honest.  '), 5);
  assert.strictEqual(wordCount('Ça marche, très bien!'), 4);
});

test('accepts Letterboxd usernames or profile URLs', () => {
  assert.strictEqual(parseLetterboxd('https://letterboxd.com/davidehrlich/films/'), 'davidehrlich');
  assert.strictEqual(parseLetterboxd('@somebody'), 'somebody');
  assert.strictEqual(parseLetterboxd(''), '');
  assert.strictEqual(parseLetterboxd('bad name!'), null);
});
