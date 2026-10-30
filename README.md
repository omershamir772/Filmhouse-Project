# FilmHouse

A networking and portfolio home for film students, independent filmmakers and institutions. It looks like an old picture palace and works like a modern collaboration hub. The focus is on making films together, not just watching them.

## Quick start

Requires **Node.js 22.13+**. Nothing else to install: without a `DATABASE_URL`, FilmHouse runs on PGlite, a full Postgres engine embedded in Node, so local development uses the same SQL as production.

```bash
npm install
npm run seed     # demo members, films, credits, recommendations, bulletins and set photos
npm run dev      # http://localhost:3000
```

Every demo account uses the password `filmhouse-demo`. Try `noa`, who is an admin (see `/admin`), or `eli_dp`, `maya_cuts` and `tomas`. To wipe and reseed, run `npm run seed -- --reset`. In development, emails (verification, password reset) are printed to the terminal.

| Command | What it does |
| --- | --- |
| `npm test` | Runs the test suite against in-memory Postgres. Set `TEST_DATABASE_URL` to use a real server. |
| `npm run migrate` | Applies new database migrations (`npm start` also does this) |
| `npm run make-admin -- <username>` | Gives a member moderator rights (`--remove` takes them away) |

All settings are environment variables; see [`.env.example`](.env.example).

## Deploying

The app is ready for production on Render, Postgres, Cloudflare R2, Resend and Sentry. Follow **[docs/DEPLOYING.md](docs/DEPLOYING.md)**, a step-by-step runbook with a launch checklist. The infrastructure is defined in [`render.yaml`](render.yaml). CI (tests on PGlite and on real Postgres 16, `npm audit`, secret scanning) is in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Security

See **[SECURITY.md](SECURITY.md)** for how members are protected, how to report a vulnerability and what to do in an incident. In short:
- verified emails, rate limits and hashed sessions
- strict CSP and HSTS
- photos re-encoded with GPS data stripped and served from a separate domain
- reports, blocking, admin moderation and an audit log
- data export and account deletion

## MVP features

**Profiles: a local IMDb.** Members choose a status (Student, Freelancer, Alumni or Institution) and list their crafts, city and school. They can link a Letterboxd account by username or profile URL. Each profile shows a filmography built from credits, the recommendations the person received grouped by craft, their frequent collaborators and their set photos.

**Films and credits.** Films are embedded from YouTube or Vimeo and never uploaded. Every film must credit a **Director, Cinematographer and Editor**. Optional roles include Lighting, Art, Sound, Composer, Colorist and more. Writing a person as `@username` links the credit to their profile, which builds the web of credits. Anyone else is credited by name until they join, and the film owner can relink them later from the edit page.

**Bulletin board.** Post crew calls or "available for work" notices. You can search by keyword, type, **location**, **roles** (several at once) and a **date range**. The date filter matches any shoot whose dates overlap the range, and posts with flexible dates always match. Past shoots are hidden unless you ask for them. Contact details are visible to signed-in members only.

**Recommendations instead of likes.** Each recommendation is about one craft on one film, such as the cinematography or the sound. It must be at least **200 words**, enforced on the server, and the form shows a live word meter. It appears on the profile of whoever was credited in that role. You can't recommend a film you worked on, and you get one recommendation per craft per film.

**Social feed.** "From the set" is a feed of behind-the-scenes photos (JPEG, PNG, WebP or GIF, up to 8 MB). Each photo can be tagged with a film you worked on.

**Homepage.** "Popular today" and "This week's programme" rank films by unique daily viewers plus recommendations. One recommendation counts as much as 10 views, and refreshing a page doesn't add views. The homepage also shows the latest recommendation, recent set photos and new bulletins.

## Design

The site is dark by default, with a light "matinee" mode in the header. The palette is brass and velvet, with Playfair Display for headings, DM Sans for body text and Courier Prime for script-style details. It has a film-grain overlay, film cards shaped like tickets, credits laid out like a typed script page, pinned notes on the bulletin board and polaroid set photos. It works on mobile and without JavaScript, which only adds enhancements.

## Architecture

```
src/
  server.js         boot: config check, migrations, Sentry, timeouts, hourly clean-up
  app.js            Express app: helmet/CSP, sessions, CSRF, read-only mode, routes
  config.js         environment settings; production refuses to start without its secrets
  db.js             Postgres (pg) or embedded PGlite, transactions, migration runner
  lib/              auth, rate limits, email, storage (local / R2), image processing, moderation
  routes/           home, auth, account, profiles, films, board, feed, moderation, policy pages
  views/            EJS templates
migrations/         versioned SQL
public/             CSS and progressive-enhancement JS
scripts/            seed, migrate, make-admin
test/               node:test suites (app, security, unit)
```

**Stack:** Express 5 with EJS server-rendered pages, PostgreSQL 16, `sharp` for images, `helmet` for security headers. There is no build step.

**Demo content:** all people and credits are fictional. The placeholder videos are Blender Foundation open movies (CC BY).

## Ideas for the next iteration

- Credit claiming: email invites for crew who are credited by name but haven't joined, and disputing a credit
- Messaging between members, and replies to bulletins
- Institution pages that list their students and graduation films
- Notifications when you're credited or recommended
- Two-factor sign-in for admins, and new-device login alerts
