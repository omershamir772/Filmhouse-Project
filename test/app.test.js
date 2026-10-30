const test = require('node:test');
const assert = require('node:assert');
const { startApp, words } = require('./helpers');

const FILM = {
  title: 'Night Bus',
  video_url: 'https://vimeo.com/76979871',
  year: '2025',
  logline: 'A driver and a passenger share the last route of the night.',
};

let ctx;
test.before(async () => {
  ctx = await startApp();
});
test.after(() => ctx.close());

test('every page renders for anonymous visitors', async () => {
  const c = ctx.client();
  for (const url of ['/', '/films', '/board', '/feed', '/people', '/login', '/signup', '/forgot', '/privacy', '/terms', '/guidelines', '/healthz']) {
    assert.strictEqual((await c.get(url)).status, 200, url);
  }
  assert.strictEqual((await c.get('/films/new')).status, 302);
  assert.strictEqual((await c.get('/nowhere')).status, 404);
});

test('POSTs without a CSRF token are rejected, multipart included', async () => {
  const c = ctx.client();
  await c.signup('csrfvictim');
  for (const url of ['/logout', '/films/1/delete', '/settings/delete']) {
    const res = await fetch(ctx.base + url, {
      method: 'POST',
      headers: { cookie: `fh_session=${c.cookies.fh_session}` },
      body: new FormData(),
    });
    assert.strictEqual(res.status, 403, url);
  }
});

test('films need a director, cinematographer and editor; @mentions link to profiles', async () => {
  const dp = ctx.client();
  await dp.signup('lens_lena', { display_name: 'Lena Lens' });
  const director = ctx.client();
  await director.signup('dir_dan', { display_name: 'Dan Director' });

  const missing = await director.post('/films', {
    ...FILM,
    credit_role: ['Director', 'Cinematographer'],
    credit_person: ['@dir_dan', '@lens_lena'],
  });
  assert.strictEqual(missing.status, 422);
  assert.match(missing.text, /needs a credited Editor/);

  const unknown = await director.post('/films', {
    ...FILM,
    credit_role: ['Director', 'Cinematographer', 'Editor'],
    credit_person: ['@dir_dan', '@nobody_here', 'Sam Cutter'],
  });
  assert.strictEqual(unknown.status, 422);
  assert.match(unknown.text, /no FilmHouse member called @nobody_here/);

  const ok = await director.post('/films', {
    ...FILM,
    credit_role: ['Director', 'Cinematographer', 'Editor', 'Sound'],
    credit_person: ['@dir_dan', '@lens_lena', 'Sam Cutter', ''],
  });
  assert.strictEqual(ok.status, 302);
  const filmPage = await director.get(ok.location);
  assert.match(filmPage.text, /player\.vimeo\.com\/video\/76979871/);
  assert.match(filmPage.text, /href="\/u\/lens_lena" class="credit-link">Lena Lens/);
  assert.match(filmPage.text, /Sam Cutter/);

  // The credit shows up in the cinematographer's filmography.
  const profile = await dp.get('/u/lens_lena');
  assert.match(profile.text, /Night Bus/);
  assert.match(profile.text, /Cinematographer/);
});

test('recommendations are role-specific, need 200 words, and land on the credited profile', async () => {
  const { id: filmId } = await ctx.db.one("SELECT id FROM films WHERE title = 'Night Bus'");
  const critic = ctx.client();
  await critic.signup('critic_cara');

  const short = await critic.post(`/films/${filmId}/recommendations`, { role: 'Cinematographer', body: words(150) });
  assert.strictEqual(short.status, 422);
  assert.match(short.text, /at least 200 words — you have 150/);

  const badRole = await critic.post(`/films/${filmId}/recommendations`, { role: 'Composer', body: words(220) });
  assert.strictEqual(badRole.status, 422);

  const ok = await critic.post(`/films/${filmId}/recommendations`, { role: 'Cinematographer', body: words(210) });
  assert.strictEqual(ok.status, 302);

  const dup = await critic.post(`/films/${filmId}/recommendations`, { role: 'Cinematographer', body: words(210) });
  assert.strictEqual(dup.status, 422);

  const profile = await critic.get('/u/lens_lena');
  assert.match(profile.text, /Cinematographer × 1/);

  // Crew can't recommend their own film.
  const dp = ctx.client();
  await dp.login('lens_lena');
  const self = await dp.post(`/films/${filmId}/recommendations`, { role: 'Editor', body: words(210) });
  assert.strictEqual(self.status, 422);
  assert.match(self.text, /You worked on this film/);
});

test('only the owner can edit or delete a film', async () => {
  const { id: filmId } = await ctx.db.one("SELECT id FROM films WHERE title = 'Night Bus'");
  const stranger = ctx.client();
  await stranger.signup('stranger');
  assert.strictEqual((await stranger.get(`/films/${filmId}/edit`)).status, 403);
  assert.strictEqual((await stranger.post(`/films/${filmId}/delete`)).status, 403);
  assert.ok(await ctx.db.one('SELECT 1 FROM films WHERE id = $1', [filmId]));
});

test('bulletin board filters by role, location and overlapping dates', async () => {
  const c = ctx.client();
  await c.signup('producer_pat');
  const post = (title, extra) =>
    c.post('/board', { kind: 'crew_call', title, description: 'Details', ...extra });

  assert.strictEqual((await post('Need a gaffer in Haifa', { roles: ['Gaffer / Lighting'], location: 'Haifa', start_date: '2099-03-01', end_date: '2099-03-03' })).status, 302);
  assert.strictEqual((await post('Need sound in Tel Aviv', { roles: ['Sound', 'Editor'], location: 'Tel Aviv', start_date: '2099-06-10', end_date: '2099-06-12' })).status, 302);
  assert.strictEqual((await post('Flexible editor gig', { roles: 'Editor', location: 'Remote' })).status, 302);
  assert.strictEqual((await post('Bad dates', { roles: 'Editor', start_date: '2099-05-02', end_date: '2099-05-01' })).status, 422);

  const titles = async (qs) => {
    const { text } = await c.get('/board?' + new URLSearchParams(qs));
    return ['Need a gaffer in Haifa', 'Need sound in Tel Aviv', 'Flexible editor gig'].filter((t) => text.includes(t));
  };

  assert.deepStrictEqual(await titles({ role: 'Editor' }), ['Need sound in Tel Aviv', 'Flexible editor gig']);
  assert.deepStrictEqual(await titles({ location: 'haifa' }), ['Need a gaffer in Haifa']);
  assert.deepStrictEqual(await titles({ from: '2099-03-02', to: '2099-03-31' }), ['Need a gaffer in Haifa', 'Flexible editor gig']);
  assert.deepStrictEqual(await titles({ from: '2099-06-11', role: 'Sound' }), ['Need sound in Tel Aviv']);
  assert.deepStrictEqual(await titles({ kind: 'available' }), []);
});

test('set photos are re-encoded with GPS data stripped, and non-images are rejected', async () => {
  const sharp = require('sharp');
  const c = ctx.client();
  await c.login('dir_dan');
  const { id: filmId } = await ctx.db.one("SELECT id FROM films WHERE title = 'Night Bus'");

  // A JPEG carrying GPS coordinates in its EXIF data.
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c76b2a' } })
    .jpeg()
    .withExif({ IFD0: { Artist: 'Dan' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '32/1 4/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '34/1 46/1 0/1' } })
    .toBuffer();
  assert.ok((await sharp(jpeg).metadata()).exif, 'fixture has EXIF');

  const form = new FormData();
  form.set('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'set.jpg');
  form.set('caption', 'Lighting the bus interior');
  form.set('film_id', String(filmId));
  const ok = await c.post('/feed', form);
  assert.strictEqual(ok.status, 302);

  const photo = await ctx.db.one('SELECT * FROM set_photos ORDER BY id DESC LIMIT 1');
  const stored = require('node:fs').readFileSync(require('node:path').join(ctx.uploadDir, photo.image_key));
  const meta = await sharp(stored).metadata();
  assert.strictEqual(meta.format, 'webp');
  assert.strictEqual(meta.exif, undefined, 'EXIF (including GPS) must be stripped');
  assert.ok(!stored.includes(Buffer.from('GPS')), 'no GPS marker in stored bytes');

  const feed = await c.get('/feed');
  assert.match(feed.text, /Lighting the bus interior/);
  assert.match(feed.text, /on set of <a href="\/films\/\d+"><em>Night Bus/);

  // An HTML file pretending to be a PNG is refused, whatever the browser claims.
  const bad = new FormData();
  bad.set('photo', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  const refused = await c.post('/feed', bad);
  assert.strictEqual(refused.status, 422);
  assert.match(refused.text, /isn(&#39;|')t an image we can read/);
});

test('home page ranks popular films by recent activity', async () => {
  const c = ctx.client();
  const { id } = await ctx.db.one("SELECT id FROM films WHERE title = 'Night Bus'");
  await c.get(`/films/${id}`);
  const home = await c.get('/');
  assert.match(home.text, /Popular today/);
  assert.match(home.text, /Night Bus/);
  assert.doesNotMatch(home.text, /The house is quiet today/);
});

test('profile settings validate and save the Letterboxd link', async () => {
  const c = ctx.client();
  await c.signup('settings_sam');
  const bad = await c.post('/settings', { display_name: 'Sam', status: 'Freelancer', letterboxd: 'not valid!' });
  assert.strictEqual(bad.status, 422);
  const ok = await c.post('/settings', {
    display_name: 'Sam Settings',
    status: 'Freelancer',
    crafts: ['Editor', 'Colorist'],
    location: 'Jerusalem',
    letterboxd: 'https://letterboxd.com/samsettings/',
  });
  assert.strictEqual(ok.status, 302);
  const profile = await c.get('/u/settings_sam');
  assert.match(profile.text, /https:\/\/letterboxd\.com\/samsettings\//);
  const people = await c.get('/people?craft=Colorist&location=jeru');
  assert.match(people.text, /Sam Settings/);
});
