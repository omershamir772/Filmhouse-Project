const test = require('node:test');
const assert = require('node:assert');
const { startApp, words, PASSWORD } = require('./helpers');
const { loadConfig } = require('../src/config');
const { sha256 } = require('../src/lib/auth');

const FILM = (extra = {}) => ({
  title: 'Harbour Lights',
  video_url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  credit_role: ['Director', 'Cinematographer', 'Editor'],
  credit_person: ['Ana Director', 'Ben Camera', 'Cleo Cutter'],
  ...extra,
});

test.describe('accounts and sessions', () => {
  let ctx;
  test.before(async () => {
    ctx = await startApp();
  });
  test.after(() => ctx.close());

  test('sign-up enforces password rules, age and terms, without revealing who has an account', async () => {
    const c = ctx.client();
    const base = { username: 'newbie', email: 'newbie@example.com', display_name: 'New Bie', status: 'Student', age: 'yes', terms: 'yes' };
    const short = await c.post('/signup', { ...base, password: 'short' });
    assert.strictEqual(short.status, 422);
    assert.match(short.text, /at least 10 characters/);
    const containsName = await c.post('/signup', { ...base, password: 'newbie-is-great' });
    assert.match(containsName.text, /can(&#39;|')t contain your username/);
    const noTerms = await c.post('/signup', { ...base, password: PASSWORD, terms: '' });
    assert.match(noTerms.text, /agree to the terms/);
    const noAge = await c.post('/signup', { ...base, password: PASSWORD, age: '' });
    assert.match(noAge.text, /at least 18/);

    await ctx.client().signup('taken_tom');
    const dupe = await c.post('/signup', { ...base, email: 'TAKEN_TOM@example.com', password: PASSWORD });
    assert.match(dupe.text, /username or email is already in use/);
  });

  test('unverified members can browse but not post until they confirm their email', async () => {
    const c = ctx.client();
    await c.signup('pending_pat', { verify: false });
    assert.strictEqual((await c.get('/films')).status, 200);
    const blocked = await c.post('/films', FILM());
    assert.strictEqual(blocked.status, 403);
    assert.match(blocked.text, /Confirm your email/);

    const link = c.lastLink('pending_pat@example.com', '/verify');
    assert.strictEqual((await c.get(link)).status, 200);
    assert.strictEqual((await c.get(link)).status, 400, 'verification links are single-use');
    assert.strictEqual((await c.post('/films', FILM())).status, 302);
  });

  test('sessions are stored hashed and the cookie is httpOnly', async () => {
    const c = ctx.client();
    const res = await c.signup('cookie_cat');
    const cookie = res.headers.getSetCookie().find((h) => h.startsWith('fh_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const token = c.cookies.fh_session;
    assert.strictEqual(await ctx.db.one('SELECT 1 FROM sessions WHERE token_hash = $1', [token]), null);
    assert.ok(await ctx.db.one('SELECT 1 FROM sessions WHERE token_hash = $1', [sha256(token)]));
  });

  test('password reset: same answer for unknown emails, single-use link, signs out every device', async () => {
    const phone = ctx.client();
    await phone.signup('reset_rita');
    const laptop = ctx.client();
    const sent = ctx.mailer.outbox.length;
    const unknown = await laptop.post('/forgot', { email: 'nobody@example.com' });
    assert.match(unknown.text, /Check your email/);
    assert.strictEqual(ctx.mailer.outbox.length, sent, 'no email for unknown addresses');

    await laptop.post('/forgot', { email: 'reset_rita@example.com' });
    const link = laptop.lastLink('reset_rita@example.com', '/reset');
    const token = new URL('http://x' + link).searchParams.get('token');
    const weak = await laptop.post('/reset', { token, password: 'short' });
    assert.strictEqual(weak.status, 422);
    assert.strictEqual((await laptop.post('/reset', { token, password: 'a brand new passphrase' })).status, 302);
    assert.strictEqual((await laptop.post('/reset', { token, password: 'another new passphrase' })).status, 400);

    // The phone's old session no longer works.
    const settings = await phone.get('/settings');
    assert.strictEqual(settings.status, 302);
    assert.strictEqual((await laptop.login('reset_rita', 'a brand new passphrase')).status, 302);
    assert.strictEqual((await laptop.login('reset_rita', PASSWORD)).status, 401);
  });

  test('changing email notifies the old address and requires confirming the new one', async () => {
    const c = ctx.client();
    await c.signup('mover_max');
    const wrong = await c.post('/settings/email', { email: 'max@new.example.com', current_password: 'not my password' });
    assert.strictEqual(wrong.status, 422);
    await c.post('/settings/email', { email: 'max@new.example.com', current_password: PASSWORD });
    assert.ok(ctx.mailer.outbox.some((m) => m.to === 'mover_max@example.com' && /was changed/.test(m.subject)));
    const user = await ctx.db.one("SELECT email_verified_at FROM users WHERE username = 'mover_max'");
    assert.strictEqual(user.email_verified_at, null);
  });

  test('data export never includes the password hash', async () => {
    const c = ctx.client();
    await c.signup('export_eve');
    const res = await c.get('/settings/export.json');
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.text);
    assert.strictEqual(data.profile.username, 'export_eve');
    assert.ok(!('password_hash' in data.profile));
    assert.doesNotMatch(res.text, /scrypt\$/);
  });

  test('deleting an account needs the password, removes the account and keeps credits as a name', async () => {
    const owner = ctx.client();
    await owner.signup('director_dee');
    const leaver = ctx.client();
    await leaver.signup('leaving_lou', { display_name: 'Lou Leaving' });
    await owner.post('/films', FILM({ title: 'Goodbye Pier', credit_person: ['@director_dee', '@leaving_lou', 'Someone Else'] }));

    const refused = await leaver.post('/settings/delete', { confirm: 'leaving_lou', current_password: 'nope' });
    assert.match(refused.text, /nothing was deleted/);
    const ok = await leaver.post('/settings/delete', { confirm: 'leaving_lou', current_password: PASSWORD });
    assert.match(ok.text, /Account deleted/);
    assert.strictEqual(await ctx.db.one("SELECT 1 FROM users WHERE username = 'leaving_lou'"), null);
    const credit = await ctx.db.one("SELECT c.* FROM credits c JOIN films f ON f.id = c.film_id WHERE f.title = 'Goodbye Pier' AND c.role = 'Cinematographer'");
    assert.strictEqual(credit.user_id, null);
    assert.strictEqual(credit.name, 'Lou Leaving');
  });

  test('responses carry security headers', async () => {
    const res = await ctx.client().get('/');
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/player\.vimeo\.com/);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-powered-by'), null);
  });
});

test.describe('moderation', () => {
  let ctx;
  let admin;
  let troll;
  let reporter;
  test.before(async () => {
    ctx = await startApp();
    admin = ctx.client();
    await admin.signup('mod_mia');
    await ctx.db.query("UPDATE users SET role = 'admin' WHERE username = 'mod_mia'");
    troll = ctx.client();
    await troll.signup('troll_ted');
    reporter = ctx.client();
    await reporter.signup('kind_kim');
  });
  test.after(() => ctx.close());

  test('the admin page is invisible to members', async () => {
    assert.strictEqual((await reporter.get('/admin')).status, 404);
    assert.strictEqual((await reporter.post('/admin/user/1/hide')).status, 404);
  });

  test('a report can be actioned: content hidden, logged, and gone from listings', async () => {
    await troll.post('/films', FILM({ title: 'Totally Real Film' }));
    const film = await ctx.db.one("SELECT id FROM films WHERE title = 'Totally Real Film'");
    assert.match((await reporter.get('/films')).text, /Totally Real Film/);

    assert.strictEqual((await reporter.post('/report', { type: 'film', id: film.id, reason: 'Spam or scam' })).status, 200);
    const page = await admin.get('/admin');
    assert.match(page.text, /Totally Real Film/);
    const report = await ctx.db.one('SELECT id FROM reports WHERE target_id = $1', [film.id]);
    await admin.post(`/admin/reports/${report.id}`, { action: 'hide' });

    assert.doesNotMatch((await reporter.get('/films')).text, /Totally Real Film/);
    assert.strictEqual((await reporter.get(`/films/${film.id}`)).status, 404);
    assert.match((await troll.get(`/films/${film.id}`)).text, /hidden by a moderator/);
    const log = await ctx.db.one("SELECT * FROM audit_log WHERE action = 'hide'");
    assert.strictEqual(log.actor_name, 'mod_mia');
    assert.strictEqual(log.target_id, film.id);
  });

  test('suspending a member signs them out and hides their profile', async () => {
    const t = await ctx.db.one("SELECT id FROM users WHERE username = 'troll_ted'");
    await admin.post(`/admin/user/${t.id}/hide`, {});
    assert.strictEqual((await troll.get('/settings')).status, 302);
    assert.strictEqual((await troll.login('troll_ted')).status, 403);
    assert.strictEqual((await reporter.get('/u/troll_ted')).status, 404);
    await admin.post(`/admin/user/${t.id}/unhide`, {});
    assert.strictEqual((await troll.login('troll_ted')).status, 302);
  });

  test('a blocked member cannot recommend the blocker’s films', async () => {
    const maker = ctx.client();
    await maker.signup('maker_mo');
    await maker.post('/films', FILM({ title: 'Quiet Harbour', credit_person: ['@maker_mo', 'Ben Camera', 'Cleo Cutter'] }));
    const film = await ctx.db.one("SELECT id FROM films WHERE title = 'Quiet Harbour'");
    await maker.post('/u/troll_ted/block', { action: 'block' });
    const rec = await troll.post(`/films/${film.id}/recommendations`, { role: 'Director', body: words(210) });
    assert.strictEqual(rec.status, 422);
    assert.match(rec.text, /can(&#39;|')t recommend this film/);
  });
});

test.describe('rate limits, invite codes and read-only mode', () => {
  test('failed logins lock the account for a while, even for the right password', async () => {
    const ctx = await startApp({ rateLimits: { loginFailuresPerAccount: [3, 900] } });
    try {
      await ctx.client().signup('locked_lee');
      const attacker = ctx.client();
      for (let i = 0; i < 3; i++) assert.strictEqual((await attacker.login('locked_lee', 'guess' + i)).status, 401);
      assert.strictEqual((await attacker.login('locked_lee')).status, 429);
    } finally {
      await ctx.close();
    }
  });

  test('sign-ups per IP are limited', async () => {
    const ctx = await startApp({ rateLimits: { signupPerIp: [2, 3600] } });
    try {
      await ctx.client().signup('one_one');
      await ctx.client().signup('two_two');
      await assert.rejects(ctx.client().signup('three_three'), /429/);
    } finally {
      await ctx.close();
    }
  });

  test('beta invite codes are required when configured', async () => {
    const ctx = await startApp({ inviteCodes: ['SEASIDE24'] });
    try {
      await assert.rejects(ctx.client().signup('no_code'), /invite-only/);
      const c = ctx.client();
      const res = await c.post('/signup', {
        username: 'with_code', email: 'with_code@example.com', display_name: 'W', status: 'Student', password: PASSWORD, age: 'yes', terms: 'yes', invite: 'SEASIDE24',
      });
      assert.strictEqual(res.status, 302);
    } finally {
      await ctx.close();
    }
  });

  test('read-only mode blocks changes but not browsing or signing in', async () => {
    const ctx = await startApp({ readOnly: true });
    try {
      const c = ctx.client();
      assert.strictEqual((await c.get('/')).status, 200);
      assert.strictEqual((await c.post('/signup', { username: 'ro' })).status, 503);
      assert.strictEqual((await c.login('nobody')).status, 401);
    } finally {
      await ctx.close();
    }
  });
});

test('production refuses to start without its secrets', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_URL[\s\S]*APP_SECRET[\s\S]*RESEND_API_KEY[\s\S]*R2_BUCKET/);
  const full = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://u:p@db/filmhouse',
    APP_URL: 'https://filmhouse.example',
    APP_SECRET: 'x'.repeat(40),
    RESEND_API_KEY: 're_123',
    EMAIL_FROM: 'FilmHouse <hello@filmhouse.example>',
    R2_ACCOUNT_ID: 'a',
    R2_ACCESS_KEY_ID: 'b',
    R2_SECRET_ACCESS_KEY: 'c',
    R2_BUCKET: 'photos',
    R2_PUBLIC_URL: 'https://media.filmhouse.example',
  };
  const config = loadConfig(full);
  assert.strictEqual(config.isProd, true);
  assert.strictEqual(config.checkBreachedPasswords, true);
  assert.throws(() => loadConfig({ ...full, APP_URL: 'http://filmhouse.example' }), /https/);
});
