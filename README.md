# FilmHouse

A networking and portfolio home for film students, independent filmmakers and institutions. It looks like an old picture palace and works like a modern collaboration hub. The focus is on making films together, not just watching them.

## Quick start

Requires **Node.js 22.13+**. It uses the built-in `node:sqlite`, so there is no database server to install.

```bash
npm install
npm run seed     # demo members, films, credits, recommendations, bulletins and set photos
npm start        # http://localhost:3000
```

Every demo account uses the password `filmhouse` (try `noa`, `eli_dp`, `maya_cuts` or `tomas`). To wipe and reseed, run `npm run seed -- --reset`. Run the tests with `npm test`.

| Env var        | Default              | Purpose                 |
| -------------- | -------------------- | ----------------------- |
| `PORT`         | `3000`               | HTTP port               |
| `FILMHOUSE_DB` | `data/filmhouse.db`  | SQLite file path        |

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
  app.js            Express app: security headers, sessions, CSRF, routes
  db.js             SQLite schema (users, films, credits, recommendations, board, photos, views)
  constants.js      roles, member statuses, 200-word minimum
  lib/              auth (scrypt + sessions + CSRF), video URL parsing, credits, ranking, formatting
  routes/           home, auth, profiles/people, films/recommendations, board, feed
  views/            EJS templates
public/             CSS and progressive-enhancement JS
scripts/seed.js     demo data
test/               node:test unit and HTTP tests
```

- **Stack:** Express 5, EJS (server-rendered), `node:sqlite` and multer. There is no build step.
- **Security:** scrypt password hashing and httpOnly SameSite session cookies. Every POST is protected with double-submit CSRF tokens, including multipart uploads. Templates escape output, and redirects only go to local paths. Uploads are checked by MIME type, size-limited and given random filenames.
- **Demo content:** all people and credits are fictional. The placeholder videos are Blender Foundation open movies (CC BY).

## Ideas for the next iteration

- Credit claiming: email invites for crew who are credited by name but haven't joined
- Messaging between members, and replies to bulletins
- Institution pages that list their students and graduation films
- Notifications when you're credited or recommended
- Moving to Postgres and object storage (S3/R2) for set photos once the site has real traffic
