const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');

// Boot an app on a random port with a throwaway database.
async function startApp() {
  const db = openDb(':memory:');
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmhouse-test-'));
  const app = createApp({ db, uploadDir });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    base,
    client: () => new Client(base),
    close: () => {
      server.close();
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

// A tiny browser: keeps cookies and fills in the CSRF token on POSTs.
class Client {
  constructor(base) {
    this.base = base;
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
      this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
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

  async signup(username, extra = {}) {
    const res = await this.post('/signup', {
      username,
      email: `${username}@example.com`,
      display_name: extra.display_name || username.toUpperCase(),
      status: extra.status || 'Student',
      password: 'correct horse battery',
    });
    if (res.status !== 302) throw new Error(`signup failed: ${res.status}`);
    return res;
  }
}

function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
}

module.exports = { startApp, words };
