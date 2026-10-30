# FilmHouse: plan for a public launch

> **Status (30 Oct 2026):** Phase 1 (security hardening in the code) and the code side of Phase 2 (Render blueprint, CI, Dependabot) are built. What remains is account setup and the launch checks in [DEPLOYING.md](DEPLOYING.md).

**Goal:** take the working MVP in this repo to a public site at its own domain, where real film students and filmmakers can sign up safely.

**Approach:** keep the current app (Express + server-rendered pages) and make it production-ready. Don't rewrite it. Its features already work and are tested. Getting to launch means replacing the parts built for a single laptop, and adding the account, safety and legal basics every public community site needs.

**Rough timeline:** about 4–5 weeks to a public launch, including a 2-week closed beta. A demo link to show people can be ready the same day (Phase 0).

---

## Recommended setup

| Need | Choice | Why |
| --- | --- | --- |
| App hosting | **Render** (web service, deploys automatically from GitHub) | Simple, managed HTTPS, no servers to look after, staging and production environments |
| Database | **Managed PostgreSQL** (Render Postgres or Neon) | Automatic backups and point-in-time restore. Lets the app run on more than one server. Replaces the local SQLite file. |
| Photo storage | **Cloudflare R2** (S3-compatible) | Cheap, no bandwidth fees, keeps uploads off the app server |
| Email | **Resend** or **Postmark** | Needed for email verification and password resets |
| Error tracking | **Sentry** (free tier) | Shows bugs from production with full details |
| Uptime alerts | **Better Stack** or **UptimeRobot** (free tier) | Sends an alert if the site goes down |
| Domain | Any registrar, with DNS on **Cloudflare** | Free DNS, plus DDoS protection in front of the site |

**Expected cost at launch:** roughly **$15–40/month** (app server, database, storage and email on small or free plans) plus the domain (~$10–20/year). Check current prices when signing up.

---

## Phase 0: demo link (same day, no code changes)

For showing Omer, schools or early supporters only. Not for real users.

- [ ] Deploy the current app to Render with a small persistent disk for the SQLite file and photos
- [ ] Load the demo data (`npm run seed`)
- [ ] Share the `*.onrender.com` link

*Limits:* runs on one server only, has no email (so no password reset), and the backups are manual.

---

## Phase 1: make the code production-ready (≈ 2 weeks)

### 1.1 Database: SQLite → PostgreSQL
- [ ] Replace `node:sqlite` with the `pg` driver. Make route handlers async. The SQL is standard, so changes are mostly mechanical.
- [ ] Add versioned migrations (`node-pg-migrate`) instead of the `CREATE TABLE IF NOT EXISTS` schema
- [ ] Move search to Postgres (`ILIKE`, plus full-text search for films and bulletins)
- [ ] Run the test suite against a real Postgres in CI

### 1.2 Photos: local disk → object storage
- [ ] Upload set photos to R2 and serve them from a CDN URL
- [ ] Resize and compress with `sharp` (e.g. 1600px plus a thumbnail)
- [ ] **Remove EXIF metadata, including GPS location**, so set photos don't reveal where people live or shoot
- [ ] Check the real file contents rather than trusting the browser's reported type

### 1.3 Accounts
- [ ] Email verification on sign-up (unverified accounts can't post or recommend)
- [ ] "Forgot password" by email
- [ ] Change email and password in settings
- [ ] Delete account and download my data (required under GDPR / Israeli privacy law)
- [ ] Profile photos (stored in R2 like set photos)

### 1.4 Safety and moderation
A community site needs these before strangers can post.
- [ ] "Report" button on profiles, films, recommendations, bulletins and photos
- [ ] Admin page: review reports, hide content, suspend accounts
- [ ] Rate limits on login, sign-up, posting and uploads (prevents spam and password guessing)
- [ ] Bulletin posts expire automatically after the shoot date

### 1.5 Hardening
- [ ] Read all settings and secrets from environment variables. Fail to start if a required one is missing.
- [ ] Add security headers with `helmet`, including a Content-Security-Policy that allows only YouTube/Vimeo embeds and our own assets
- [ ] Enforce HTTPS. Mark cookies `Secure` in production.
- [ ] `/healthz` endpoint for the host and the uptime monitor
- [ ] Structured logging and Sentry error reporting
- [ ] Vimeo thumbnails via Vimeo's oEmbed API (currently YouTube only)

---

## Phase 2: infrastructure (≈ 2–3 days, can overlap with Phase 1)

- [ ] **CI:** GitHub Actions runs the tests on every pull request. Code can't merge if they fail.
- [ ] **Two environments:**
  - `staging`: auto-deploys from `main`, filled with demo data
  - `production`: deploys when promoted manually
- [ ] **Infrastructure as code:** a `render.yaml` blueprint so the setup can be rebuilt from the repo
- [ ] **Database backups:** daily backups plus point-in-time restore. **Rehearse a restore once before launch.**
- [ ] **Domain:**
  - DNS on Cloudflare
  - HTTPS certificate
  - `www` redirects to the bare domain
- [ ] **Email sending:** set up the domain's SPF, DKIM and DMARC records so emails don't land in spam
- [ ] **Monitoring:** uptime check on `/healthz`, Sentry alerts to email or Slack

---

## Phase 3: legal and content (≈ 1 week, in parallel, mostly non-engineering)

- [ ] Privacy policy: what we store, why, how long, and how to delete it
- [ ] Terms of use, including a minimum age. Film students may be under 18, so decide 16+ or 18+.
- [ ] Community guidelines: the tone for recommendations and bulletins (anti-toxic, pro-craft)
- [ ] Copyright and takedown contact, for films embedded without permission
- [ ] Cookie notice. The site uses only essential cookies, so a consent banner is likely unnecessary. Confirm this for the regions we target.
- [ ] Final branding: name check for "FilmHouse" (trademark and domain availability), logo, favicon, social share image

---

## Phase 4: closed beta (≈ 2 weeks)

- [ ] Invite one or two film schools plus about 50 filmmakers (invite codes on sign-up)
- [ ] Help them add real films and credit each other. This is when the web of credits starts to fill in.
- [ ] Feedback link on every page; weekly fix-and-deploy cycle
- [ ] Watch for the most common issues: credit-tagging confusion, the 200-word recommendation minimum, and board search
- [ ] Basic load check: make sure the site stays fast with a few hundred concurrent users

---

## Phase 5: public launch checklist

- [ ] All Phase 1–3 boxes checked
- [ ] Restore from backup has been tested
- [ ] Admin and moderation accounts set up, and someone on call for reports in launch week
- [ ] Remove demo data from production
- [ ] Analytics that respect privacy (e.g. Plausible) to see what people use
- [ ] Launch posts to film school communities, Letterboxd circles, and student film groups

---

## After launch: roadmap

1. Invite crew credited only by name, so they can join and claim their credits
2. Notifications ("you were credited", "you got a recommendation")
3. Direct messages and replies to bulletins
4. Institution pages: a school's students, alumni and graduation films
5. Saved board searches with email alerts ("new Gaffer calls in Tel Aviv")

---

## Who does what

| Task | Who |
| --- | --- |
| All code changes, CI, `render.yaml`, migrations, tests | Claude (in this repo) |
| Create accounts (Render, Cloudflare, R2, Resend, Sentry), buy the domain, enter secrets and billing | Project owner. Claude can't create accounts or handle payment details. |
| Privacy policy, terms and guidelines | Draft by Claude; **review by a lawyer** before launch |
| Beta recruitment, moderation, community | Omer and the team |

## Decisions needed from the team

1. **Domain name**, and whether "FilmHouse" is clear to use as a name
2. **Minimum age**: 16+ or 18+
3. **Launch region(s)**: Israel only, or EU/international too (affects privacy obligations)
4. **Who owns the hosting accounts and pays the bills**
5. **Beta partners**: which film schools to approach first
