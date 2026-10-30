const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { openDb, migrate } = require('../src/db');
const { loadConfig } = require('../src/config');
const { createMailer } = require('../src/lib/email');

const PASSWORD = 'correct horse battery';
let schemaCounter = 0;

/**
 * Tests use in-memory PGlite by default. Set TEST_DATABASE_URL to run them against a real
 * Postgres server instead (CI does); each app then gets its own fresh schema.
 */
async function openTestDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDb('memory://');
  const schema = `test_${process.pid}_${++schemaCounter}`;
  const admin = await openDb(url);
  await admin.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
  await admin.close();
  return openDb(url, { searchPath: schema });
}
const GENEROUS = [10_000, 3600];

/**
 * Boot an app on a random port with a throwaway in-memory Postgres (PGlite).
 * `rateLimits` and other config can be overridden per test file.
 */
async function startApp(overrides = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmhouse-test-'));
  const base = loadConfig({ NODE_ENV: 'test', UPLOAD_DIR: uploadDir });
  const config = {
    ...base,
    checkBreachedPasswords: false,
    rateLimits: Object.fromEntries(Object.keys(base.rateLimits).map((k) => [k, GENEROUS])),
    ...overrides,
    rateLimits: { ...Object.fromEntries(Object.keys(base.rateLimits).map((k) => [k, GENEROUS])), ...(overrides.rateLimits || {}) },
  };
  const db = await openTestDb();
  await migrate(db);
  const mailer = createMailer({}, { log: () => {} });
  const app = createApp({ config, db, mailer });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    mailer,
    uploadDir,
    base: url,
    client: () => new Client(url, mailer),
    close: async () => {
      server.close();
      await db.close();
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

// A tiny browser: keeps cookies and fills in the CSRF token on POSTs.
class Client {
  constructor(base, mailer) {
    this.base = base;
    this.mailer = mailer;
    this.cookies = {};
  }

  async request(method, url, body) {
    let payload;
    if (body instanceof FormData) {
      if (!body.has('_csrf')) body.set('_csrf', await this.csrf());
      payload = body;
    } else if (body) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries({ _csrf: await this.csrf(), ...body })) {
        for (const item of [].concat(v)) params.append(k, item);
      }
      payload = params;
    }
    const headers = { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    const res = await fetch(this.base + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const value = pair.slice(i + 1);
      if (value) this.cookies[pair.slice(0, i)] = value;
      else delete this.cookies[pair.slice(0, i)];
    }
    return { status: res.status, headers: res.headers, location: res.headers.get('location'), text: await res.text() };
  }

  async csrf() {
    if (!this.cookies.fh_csrf) await this.get('/login');
    return this.cookies.fh_csrf;
  }

  get(url) {
    return this.request('GET', url);
  }

  post(url, body = {}) {
    return this.request('POST', url, body);
  }

  // The most recent link emailed to `email` whose path starts with `pathPrefix`.
  lastLink(email, pathPrefix) {
    const mail = [...this.mailer.outbox].reverse().find((m) => m.to === email && m.text.includes(pathPrefix));
    if (!mail) throw new Error(`No ${pathPrefix} email for ${email}`);
    return new URL(mail.text.match(/https?:\/\/\S+/)[0]).pathname + new URL(mail.text.match(/https?:\/\/\S+/)[0]).search;
  }

  /** Sign up and (unless verify:false) confirm the email address. */
  async signup(username, { verify = true, display_name, status = 'Student' } = {}) {
    const email = `${username}@example.com`;
    const res = await this.post('/signup', {
      username,
      email,
      display_name: display_name || username.toUpperCase(),
      status,
      password: PASSWORD,
      age: 'yes',
      terms: 'yes',
    });
    if (res.status !== 302) throw new Error(`signup failed: ${res.status} ${res.text.match(/<li>(.*?)<\/li>/)?.[1] || ''}`);
    if (verify) {
      const v = await this.get(this.lastLink(email, '/verify'));
      if (v.status !== 200) throw new Error('verify failed');
    }
    return res;
  }

  login(login, password = PASSWORD) {
    return this.post('/login', { login, password });
  }
}

function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
}

module.exports = { startApp, words, PASSWORD };
