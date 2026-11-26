const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startApp } = require('./helpers');

const built = fs.existsSync(path.join(__dirname, '..', 'public', 'map', '.vite', 'manifest.json'));

test.describe('world map page', () => {
  let ctx;
  test.before(async () => {
    ctx = await startApp();
  });
  test.after(() => ctx.close());

  test('is linked from the site navigation', async () => {
    const res = await ctx.client().get('/');
    assert.match(res.text, /href="\/map"/);
  });

  test('serves the built React app with the visitor in its context', { skip: !built && 'map not built (npm run build)' }, async () => {
    const c = ctx.client();
    await c.signup('map_maya', { display_name: '</script><b>Maya' });
    const res = await c.get('/map');
    assert.strictEqual(res.status, 200);
    assert.match(res.text, /<script type="module" src="\/static\/map\/assets\/index-[\w-]+\.js"><\/script>/);
    const json = res.text.match(/<script id="filmhouse-map-context" type="application\/json">(.*?)<\/script>/)[1];
    assert.doesNotMatch(json, /</, 'context JSON cannot break out of its script tag');
    assert.deepStrictEqual(JSON.parse(json).user, { username: 'map_maya', displayName: '</script><b>Maya' });

    const asset = res.text.match(/src="(\/static\/map\/assets\/[^"]+)"/)[1];
    assert.strictEqual((await c.get(asset)).status, 200);
  });

  test('relaxes inline styles for the map only; scripts stay locked down', { skip: !built && 'map not built' }, async () => {
    const c = ctx.client();
    const map = (await c.get('/map')).headers.get('content-security-policy');
    assert.match(map, /style-src 'self' 'unsafe-inline'/);
    assert.match(map, /script-src 'self';/);
    const home = (await c.get('/')).headers.get('content-security-policy');
    assert.doesNotMatch(home, /unsafe-inline/);
  });
});
