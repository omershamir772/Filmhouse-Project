// Fill a fresh database with demo members, films, credits, recommendations and bulletins.
//
//   npm run seed            # seeds the development database (refuses if it already has users)
//   npm run seed -- --reset # wipes the development database and uploads first
//
// All people and credits are fictional. The embedded videos are Blender Foundation open movies
// (CC BY), used only as placeholder footage. Never run against production.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { loadConfig } = require('../src/config');
const { openDb, migrate } = require('../src/db');
const { createStorage } = require('../src/lib/storage');
const { hashPassword } = require('../src/lib/auth');
const { parseVideoUrl } = require('../src/lib/video');
const { wordCount } = require('../src/lib/text');
const { MIN_RECOMMENDATION_WORDS } = require('../src/constants');

const DEMO_PASSWORD = 'filmhouse-demo';
const ADMIN = 'noa';

const people = [
  ['noa', 'Noa Ben-David', 'Student', 'Director,Writer', 'Tel Aviv', 'Sam Spiegel Film School', 'noabd', 'Writer-director drawn to quiet family dramas and long takes. Currently prepping my thesis film about my grandmother\'s bakery.'],
  ['eli_dp', 'Eli Marchetti', 'Freelancer', 'Cinematographer,Gaffer / Lighting', 'Rome', '', 'elimarchetti', 'Cinematographer. 16mm whenever the budget allows, natural light whenever the schedule allows. Own a small lighting kit and a very patient car.'],
  ['maya_cuts', 'Maya Okafor', 'Alumni', 'Editor,Colorist', 'London', 'National Film and Television School', '', 'Editor and colourist. I believe most films are found in the edit, and most edits are found at 3 a.m.'],
  ['jonah_sound', 'Jonah Weiss', 'Student', 'Sound,Composer', 'Berlin', 'dffb', 'jonahweiss', 'Location sound, sound design and the occasional score. I collect room tones the way other people collect stamps.'],
  ['ines', 'Inês Carvalho', 'Freelancer', 'Production Design / Art,Costume', 'Lisbon', '', '', 'Production designer. Flea markets are my research library.'],
  ['tomas', 'Tomás Rivera', 'Student', 'Director,Producer,Assistant Director', 'Mexico City', 'CCC', 'tomasrivera', 'Producer-director. I like films with a lot of people in them, and schedules that somehow work.'],
  ['ada_writes', 'Ada Lindqvist', 'Alumni', 'Writer,Director', 'Stockholm', 'Stockholm University of the Arts', 'adalindqvist', 'Screenwriter. Ghosts, winters and siblings, usually all three.'],
  ['filmschool', 'Harbour Film School', 'Institution', '', 'Haifa', 'Harbour Film School', '', 'A small independent film school by the sea. We post our graduation films and crew calls for student productions here.'],
];

const films = [
  {
    owner: 'noa', title: 'The Last Loaf', year: 2025, runtime: 14,
    url: 'https://www.youtube.com/watch?v=eRsGyueVLvQ',
    logline: 'On the final night before her family\'s bakery closes, a girl tries to remember her grandmother\'s recipe by heart.',
    credits: [['Director', 'noa'], ['Writer', 'noa'], ['Cinematographer', 'eli_dp'], ['Editor', 'maya_cuts'], ['Sound', 'jonah_sound'], ['Production Design / Art', 'ines'], ['Producer', 'Dana Levi']],
  },
  {
    owner: 'tomas', title: 'Paper Boats', year: 2024, runtime: 11,
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    logline: 'Two brothers race paper boats down a flooded street while their parents argue about leaving the city.',
    credits: [['Director', 'tomas'], ['Producer', 'tomas'], ['Cinematographer', 'eli_dp'], ['Editor', 'Lucía Fernández'], ['Gaffer / Lighting', 'Marco Pini'], ['Composer', 'jonah_sound']],
  },
  {
    owner: 'ada_writes', title: 'Snowblind', year: 2025, runtime: 18,
    url: 'https://www.youtube.com/watch?v=R6MlUcmOul8',
    logline: 'A night-shift radio host starts receiving calls from her brother, who has been missing for a year.',
    credits: [['Director', 'ada_writes'], ['Writer', 'ada_writes'], ['Cinematographer', 'Henrik Sjöberg'], ['Editor', 'maya_cuts'], ['Colorist', 'maya_cuts'], ['Sound', 'jonah_sound'], ['Production Design / Art', 'ines']],
  },
  {
    owner: 'filmschool', title: 'Low Tide', year: 2025, runtime: 9,
    url: 'https://www.youtube.com/watch?v=Y-rmzh0PI3c',
    logline: 'A graduation film about a lighthouse keeper\'s daughter and the summer the sea stopped coming back.',
    credits: [['Director', 'Yael Mizrahi'], ['Cinematographer', 'noa'], ['Editor', 'tomas'], ['Sound', 'jonah_sound'], ['Assistant Director', 'tomas']],
  },
];

const recommendations = [
  {
    author: 'ada_writes', film: 'The Last Loaf', role: 'Cinematographer',
    body: `What stayed with me most about The Last Loaf is how patient the camera is. Eli Marchetti lets the bakery breathe. The opening shot holds on the empty counter for what must be twenty seconds, and instead of feeling slow it feels like we are being let into a room that has its own memory. Flour hangs in the air and catches the window light, and that single detail does more world-building than any line of dialogue.

The lighting is almost entirely motivated by practicals: the oven glow, a bare bulb above the work table, the blue spill from the street at night. It never looks like a film set, and yet every frame is composed. I especially admired the choice to keep the grandmother's photograph slightly out of focus in the background of the kneading scene. We feel her presence without the film pointing at her.

If I had one note, it would be that the handheld section near the end breaks the visual language a little abruptly. I understand the intention, the panic of forgetting, but a gentler transition might have kept the spell intact.

Still, this is cinematography that serves story first and beauty second, which is exactly the right order. I would happily work with this DP, and I hope other directors watching this notice the restraint and care in every setup.`,
  },
  {
    author: 'eli_dp', film: 'Snowblind', role: 'Sound',
    body: `Snowblind is a film you could almost watch with your eyes closed, and I mean that as the highest compliment to Jonah Weiss's sound work. The radio studio is a tiny, dead room, and Jonah makes it feel even smaller: no reverb, the hum of the console, the soft click of the fader. Then the phone calls come in, and the sound suddenly opens up into enormous, windy, snow-muffled spaces that we never actually see. The contrast between the two acoustic worlds tells the whole story of the film. She is trapped; he is lost somewhere vast.

I was also struck by how carefully the silence is used. There is a moment, about two thirds in, where the call drops and for maybe four seconds there is nothing at all, not even room tone. In a cinema it would be terrifying. It made me hold my breath at my desk.

The mix is clean and the dialogue is always intelligible, which is not a given in student films, especially with so much wind in the design. The music is sparse and leaves room for the effects to carry emotion.

As a cinematographer I often forget how much of the image the audience actually hears. This film is a reminder. Anyone looking for a sound designer who thinks about story, not just levels, should look at this work closely.`,
  },
  {
    author: 'noa', film: 'Snowblind', role: 'Editor',
    body: `The editing in Snowblind is a masterclass in rhythm for a short film. Maya Okafor builds the story almost entirely through the cadence of the phone calls. The first call is cut in a loose, almost casual way, with long reaction shots and some breathing room. Each following call gets a little tighter, the cuts land a little earlier, and by the last one we are cutting on the inhale before every line. You feel the walls closing in without anyone telling you that they are.

What I admire most is what Maya chose to leave out. We never get a flashback to the brother, never see a photograph, never see the night he disappeared. A less confident editor would have reached for that material to explain things. Here, the absence becomes the subject of the film, and we fill the gaps ourselves.

The transitions between the studio and the exterior shots of the snowed-in town are also handled beautifully. They work like chapter breaks and give us a moment to process before the next call arrives.

I would have liked the final scene to run perhaps ten seconds longer before the cut to black, just to let the last line land, but that is a matter of taste. This is thoughtful, brave editing, and it made me rethink the cut of my own thesis film.`,
  },
];

const bulletins = [
  {
    author: 'noa', kind: 'crew_call', title: 'Gaffer + grip for a 3-day thesis shoot in Jaffa',
    description: 'We are shooting the bakery scenes for my thesis film in a real bakery in Jaffa, mostly at night. Small, friendly crew of eight. Looking for a gaffer who is comfortable with practicals and small LED units, and a grip who can help with a dolly on a tight floor.\n\nMeals, transport from Tel Aviv and full credit. Small stipend for both roles.',
    location: 'Tel Aviv-Yafo', start: 21, end: 23, comp: 'Stipend + meals', contact: 'noa@example.com', roles: ['Gaffer / Lighting', 'Assistant Director'],
  },
  {
    author: 'filmschool', kind: 'crew_call', title: 'Graduation film season — sound, art and editing teams wanted',
    description: 'Our graduating class is shooting six short films between November and January. Each production is looking for location sound, art department and post-production help. A great way to build your reel and meet next year\'s directors.\n\nAll productions follow our school safety and working-hours policy.',
    location: 'Haifa', start: 10, end: 75, comp: 'Credit + meals, travel covered', contact: 'productions@example.edu', roles: ['Sound', 'Production Design / Art', 'Editor'],
  },
  {
    author: 'eli_dp', kind: 'available', title: 'DP with 16mm kit, free for shorts in December',
    description: 'I will be in Tel Aviv and Haifa for most of December and have a 16mm package with me (Arri SR2, a set of Zeiss primes, a small LED kit). Happy to shoot shorts, music videos or tests. Especially interested in projects that want to shoot on film for the first time.',
    location: 'Tel Aviv / Haifa', start: 32, end: 60, comp: 'Rate negotiable for students', contact: 'Message me via my profile', roles: ['Cinematographer', 'Gaffer / Lighting'],
  },
  {
    author: 'tomas', kind: 'crew_call', title: 'Music video — 1 day, need an editor with colour skills',
    description: 'One-day music video shoot for a local band. We already have a DP and a director. Looking for an editor who can also grade, ideally in DaVinci Resolve. Remote post is fine.',
    location: 'Remote', start: null, end: null, comp: 'Paid', contact: 'tomas@example.com', roles: ['Editor', 'Colorist'],
  },
];

const photos = [
  ['noa', 'The Last Loaf', 'Night 2. The oven was our key light for the whole scene.', ['#2a160c', '#c76b2a', '#f2c46d']],
  ['eli_dp', 'Paper Boats', 'Rain towers, wet suits and two very brave kids.', ['#0f1a22', '#2d5a73', '#9cc3d5']],
  ['ines', 'Snowblind', 'Building the radio studio out of a closet and a lot of egg crate foam.', ['#1b1411', '#6b3a2a', '#d9a066']],
  ['jonah_sound', 'Snowblind', 'Recording wind on the roof at 4 a.m. Worth it.', ['#11141c', '#3b4a6b', '#c9d3e8']],
  ['tomas', 'Low Tide', 'Slating the last shot of the graduation film.', ['#1a120c', '#7a2e22', '#e0a84e']],
  ['maya_cuts', 'Snowblind', 'Assembly cut day. Index cards everywhere.', ['#16120e', '#4f5a3a', '#d8cfa5']],
];

// Generated stand-ins for set photos: a warm gradient with a caption, like a contact sheet frame.
function placeholderPhoto(caption, [a, b, c]) {
  const words = caption.split(' ');
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= 34) lines[lines.length - 1] = last + ' ' + w;
    else lines.push(w);
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <radialGradient id="g" cx="35%" cy="30%" r="90%"><stop offset="0" stop-color="${c}"/><stop offset="0.45" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></radialGradient>
    <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0"/></filter>
  </defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <rect width="800" height="600" filter="url(#n)"/>
  <g fill="#fff" fill-opacity="0.92" font-family="Courier New, monospace" font-size="30">
    ${lines.map((l, i) => `<text x="48" y="${470 + (i - lines.length + 2) * 40}">${esc(l)}</text>`).join('\n    ')}
  </g>
  <text x="752" y="70" text-anchor="end" fill="#fff" fill-opacity="0.6" font-family="Courier New, monospace" font-size="22">FILMHOUSE · BTS</text>
</svg>`;
}

function daysFromNow(n) {
  if (n === null) return null;
  return new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
}

async function main() {
  const config = loadConfig();
  if (config.isProd) throw new Error('Refusing to seed demo data into production.');
  const reset = process.argv.includes('--reset');
  if (reset && config.databaseUrl.startsWith('pglite://')) {
    fs.rmSync(config.databaseUrl.replace('pglite://', ''), { recursive: true, force: true });
  }
  if (reset && config.storage.driver === 'local') fs.rmSync(path.resolve(config.storage.uploadDir), { recursive: true, force: true });

  const db = await openDb(config.databaseUrl);
  await migrate(db);
  if (reset && !config.databaseUrl.startsWith('pglite://')) {
    await db.exec('TRUNCATE users, films, credits, film_views, recommendations, board_posts, board_post_roles, set_photos, reports, blocks, audit_log, sessions, email_tokens, rate_limits RESTART IDENTITY CASCADE');
  }
  if ((await db.one('SELECT COUNT(*) AS n FROM users')).n > 0) {
    console.error('The database already has members. Run `npm run seed -- --reset` to start over.');
    process.exit(1);
  }
  const storage = createStorage(config.storage);

  // Placeholder set photos are rendered before the transaction (sharp is slow-ish).
  const photoFiles = [];
  for (const [, , caption, palette] of photos) {
    const svg = Buffer.from(placeholderPhoto(caption, palette));
    const id = crypto.randomBytes(16).toString('hex');
    const full = await sharp(svg).webp({ quality: 82 }).toBuffer();
    const thumb = await sharp(svg).resize(480, 480, { fit: 'cover' }).webp({ quality: 78 }).toBuffer();
    await storage.put(`photos/${id}.webp`, full, 'image/webp');
    await storage.put(`photos/${id}-thumb.webp`, thumb, 'image/webp');
    photoFiles.push({ image_key: `photos/${id}.webp`, thumb_key: `photos/${id}-thumb.webp` });
  }

  await db.tx(async (tx) => {
    const ids = {};
    const passwordHash = hashPassword(DEMO_PASSWORD);
    for (const [username, name, status, crafts, location, school, letterboxd, bio] of people) {
      const row = await tx.one(
        `INSERT INTO users (username, email, password_hash, display_name, status, crafts, location, school, letterboxd, bio, role, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()) RETURNING id`,
        [username, `${username}@example.com`, passwordHash, name, status, crafts, location, school, letterboxd, bio, username === ADMIN ? 'admin' : 'member'],
      );
      ids[username] = row.id;
    }

    const filmIds = {};
    for (const [i, f] of films.entries()) {
      const video = parseVideoUrl(f.url);
      const row = await tx.one(
        `INSERT INTO films (owner_id, title, year, runtime_min, logline, video_url, provider, video_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() - make_interval(days => $9)) RETURNING id`,
        [ids[f.owner], f.title, f.year, f.runtime, f.logline, f.url, video.provider, video.id, (films.length - i) * 2],
      );
      filmIds[f.title] = row.id;
      for (const [pos, [role, who]] of f.credits.entries()) {
        const user = people.find((p) => p[0] === who);
        await tx.query('INSERT INTO credits (film_id, role, user_id, name, position) VALUES ($1, $2, $3, $4, $5)', [
          row.id,
          role,
          user ? ids[who] : null,
          user ? user[1] : who,
          pos,
        ]);
      }
    }

    for (const [i, r] of recommendations.entries()) {
      const words = wordCount(r.body);
      if (words < MIN_RECOMMENDATION_WORDS) throw new Error(`Seed recommendation on ${r.film} is only ${words} words`);
      await tx.query(
        `INSERT INTO recommendations (film_id, author_id, role, body, word_count, created_at)
         VALUES ($1, $2, $3, $4, $5, now() - make_interval(hours => $6))`,
        [filmIds[r.film], ids[r.author], r.role, r.body, words, i * 20 + 3],
      );
    }

    // Simulated audience so the "popular" shelves have something to show.
    const audience = { 'The Last Loaf': [14, 30], Snowblind: [22, 41], 'Paper Boats': [3, 18], 'Low Tide': [6, 9] };
    for (const [title, [today, week]] of Object.entries(audience)) {
      for (let v = 0; v < week; v++) {
        const minutesAgo = v < today ? v * 20 : (1 + (v % 6)) * 1440;
        await tx.query(
          `INSERT INTO film_views (film_id, viewer, day, viewed_at)
           VALUES ($1, $2, (now() - make_interval(mins => $3))::date, now() - make_interval(mins => $3)) ON CONFLICT DO NOTHING`,
          [filmIds[title], `seed-${v}`, minutesAgo],
        );
      }
    }

    for (const b of bulletins) {
      const row = await tx.one(
        `INSERT INTO board_posts (author_id, kind, title, description, location, start_date, end_date, compensation, contact)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [ids[b.author], b.kind, b.title, b.description, b.location, daysFromNow(b.start), daysFromNow(b.end), b.comp, b.contact],
      );
      for (const role of b.roles) await tx.query('INSERT INTO board_post_roles (post_id, role) VALUES ($1, $2)', [row.id, role]);
    }

    for (const [i, [author, film, caption]] of photos.entries()) {
      await tx.query(
        `INSERT INTO set_photos (author_id, film_id, image_key, thumb_key, width, height, caption, created_at)
         VALUES ($1, $2, $3, $4, 800, 600, $5, now() - make_interval(hours => $6))`,
        [ids[author], filmIds[film], photoFiles[i].image_key, photoFiles[i].thumb_key, caption, i * 7 + 1],
      );
    }
  });

  await db.close();
  console.log(`Seeded ${people.length} members, ${films.length} films, ${recommendations.length} recommendations and ${bulletins.length} bulletins.`);
  console.log(`Sign in as any of: ${people.map((p) => p[0]).join(', ')} — password "${DEMO_PASSWORD}". @${ADMIN} is an admin.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
