// Fixed-window rate limiting stored in Postgres, so limits hold across every app instance.

async function consume(db, key, [limit, windowSec]) {
  const row = await db.one(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count, extract(epoch FROM window_start)::float8 AS start`,
    [key, windowSec],
  );
  const retryAfter = Math.max(1, Math.ceil(row.start + windowSec - Date.now() / 1000));
  return { allowed: row.count <= limit, retryAfter };
}

async function peek(db, key, [limit, windowSec]) {
  const row = await db.one(
    `SELECT count FROM rate_limits WHERE key = $1 AND window_start = to_timestamp(floor(extract(epoch FROM now()) / $2) * $2)`,
    [key, windowSec],
  );
  return { allowed: !row || row.count < limit };
}

// Express middleware: `keyFn(req)` names the bucket, e.g. the client IP or user id.
function rateLimit(name, keyFn) {
  return async (req, res, next) => {
    const { db, config } = req.app.locals;
    const { allowed, retryAfter } = await consume(db, `${name}:${keyFn(req)}`, config.rateLimits[name]);
    if (allowed) return next();
    res.set('Retry-After', String(retryAfter));
    res.status(429).render('error', {
      title: 'Slow down a little',
      message: `You've done that a lot in a short time. Please try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
    });
  };
}

module.exports = { consume, peek, rateLimit };
