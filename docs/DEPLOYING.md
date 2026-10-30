# Deploying FilmHouse

A step-by-step runbook for putting FilmHouse online securely. The code side is done. Everything below is account setup that the project owner does, because it involves creating accounts, billing and secrets. Plan for about half a day.

**Stack:** Render (app and Postgres), Cloudflare (DNS, HTTPS, R2 photo storage), Resend (email), Sentry (errors).

---

## 0. Before you start

- [ ] Use a shared team email (e.g. `team@filmhouse.example`) for every account below, not a personal one.
- [ ] Turn on **two-factor authentication** on GitHub, Render, Cloudflare, Resend, Sentry and the domain registrar as you create each account.
- [ ] Buy the domain, and move its DNS to Cloudflare (Cloudflare walks you through it when you add the site).

## 1. GitHub

- [ ] Settings → Branches → protect `main`: require a pull request, and require the **CI** checks to pass.
- [ ] Settings → Code security: turn on **Dependabot alerts**, **Dependabot security updates** and **Secret scanning** (with push protection).

## 2. Cloudflare R2 (set photos)

1. R2 → Create bucket `filmhouse-photos`. Leave public access **off**.
2. Bucket → Settings → Custom domain → `media.filmhouse.example`. This becomes `R2_PUBLIC_URL`. Photos are served from this separate domain, never from the app's own domain.
3. R2 → Manage API tokens → Create token with **Object Read & Write** on this bucket only. Copy the Access Key ID, Secret Access Key and Account ID.

## 3. Resend (email)

1. Add the domain `filmhouse.example` and add the DNS records Resend shows (SPF, DKIM) in Cloudflare.
2. Add a DMARC record in Cloudflare: `TXT _dmarc` → `v=DMARC1; p=quarantine; rua=mailto:team@filmhouse.example`.
3. Create an API key with **sending access only**. This is `RESEND_API_KEY`. Set `EMAIL_FROM` to e.g. `FilmHouse <hello@filmhouse.example>`.

## 4. Sentry (errors)

Create a Node.js project and copy its DSN (`SENTRY_DSN`). The app strips cookies, headers and form bodies before sending errors.

## 5. Render (app + database)

1. New → **Blueprint** → choose this repository. Render reads `render.yaml` and creates:
   - `filmhouse`: the web service. Health check `/healthz`; runs migrations on start.
   - `filmhouse-db`: Postgres 16 with **no public access** (`ipAllowList: []`) and daily backups.
2. Fill in the values it asks for (`APP_URL`, `EMAIL_FROM`, `RESEND_API_KEY`, `R2_*`, `SENTRY_DSN`, optionally `BETA_INVITE_CODES`). `APP_SECRET` is generated automatically.
3. Check that plan names and the region match what you want. Render's validation will flag anything it doesn't recognise.
4. The app refuses to start if a required setting is missing. Check the deploy log if it doesn't come up.
5. Settings → Custom domain → add `filmhouse.example` (and `www`). In Cloudflare, point the DNS records at Render with the orange-cloud proxy **on**, and set SSL/TLS mode to **Full (strict)**.
6. Leave `TRUST_PROXY=2` when Cloudflare's proxy is on, or set it to `1` if you turn the proxy off. This makes rate limits see each visitor's real IP.

**Staging:** create a second Blueprint instance from the same repo with names suffixed `-staging` and `APP_URL=https://staging.filmhouse.example`. Load demo data there with `npm run seed` from its Shell. Seeding refuses to run in production.

## 6. First admin

1. Sign up on the live site with your own account and confirm your email.
2. Render → `filmhouse` → Shell: `npm run make-admin -- <your-username>`.
3. Repeat for a second moderator. Both must have two-factor on their email accounts.

## 7. Monitoring

- [ ] Uptime monitor (Better Stack or UptimeRobot) on `https://filmhouse.example/healthz` every minute, alerting by email or Slack.
- [ ] Sentry alert rule: email on every new issue.

## 8. Launch gate

Tick all of these before opening to the public:

- [ ] **Backup restore rehearsed:** Render → `filmhouse-db` → Recovery → restore to a new database, point staging at it, and check that the site works.
- [ ] **Security scan:** run [OWASP ZAP baseline](https://www.zaproxy.org/docs/docker/baseline-scan/) against staging, and fix anything High.
- [ ] **Rate limits work:** a sixth wrong password for one account in 15 minutes shows "Too many failed attempts".
- [ ] **Photos are clean:** upload a phone photo with location on, download it from the site, and check its info shows no GPS.
- [ ] **Policies reviewed:** a lawyer has reviewed `/privacy`, `/terms` and `/guidelines`. Then remove the draft banner (`src/views/pages/_draft.ejs`) and add the contact emails.
- [ ] At least two admins with two-factor login.
- [ ] `BETA_INVITE_CODES` removed (or kept for a closed beta).

## Optional hardening: a limited database user

By default the app connects as the database owner. To limit what a compromised app could do, create a role that can read and write data but not change the schema. Run migrations as the owner, and run the app as this role:

```sql
CREATE ROLE filmhouse_app LOGIN PASSWORD '<strong password>';
GRANT CONNECT ON DATABASE filmhouse TO filmhouse_app;
GRANT USAGE ON SCHEMA public TO filmhouse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO filmhouse_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO filmhouse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO filmhouse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO filmhouse_app;
```

Then set the app's `DATABASE_URL` to use `filmhouse_app`. Run `npm run migrate` with the owner's connection string before each deploy that adds a migration.

## Every week

- Merge Dependabot pull requests once CI is green.
- Review Sentry issues and the moderation queue at `/admin`.
- Check the backups ran. Rehearse a restore every 3 months.
- Review who has access to GitHub, Render, Cloudflare and admin accounts.

## If something goes wrong

See [SECURITY.md](../SECURITY.md#incident-response).
