// All settings come from environment variables. In production, missing required settings stop
// the app from starting rather than letting it run half-configured.

function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const num = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));

  const config = {
    env: env.NODE_ENV || 'development',
    isProd,
    port: num(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL || 'pglite://data/pglite',
    appUrl: (env.APP_URL || `http://localhost:${num(env.PORT, 3000)}`).replace(/\/$/, ''),
    // Used to sign view-count hashes; must be long and random in production.
    appSecret: env.APP_SECRET || 'dev-only-secret-do-not-use-in-production',
    // Number of proxies in front of the app (Render + Cloudflare = 2 hops is typical; Render alone = 1).
    trustProxy: num(env.TRUST_PROXY, isProd ? 1 : 'loopback'),
    email: {
      resendApiKey: env.RESEND_API_KEY || '',
      from: env.EMAIL_FROM || 'FilmHouse <no-reply@localhost>',
    },
    storage: {
      driver: env.R2_BUCKET ? 'r2' : 'local',
      uploadDir: env.UPLOAD_DIR || 'uploads',
      r2: {
        accountId: env.R2_ACCOUNT_ID || '',
        accessKeyId: env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
        bucket: env.R2_BUCKET || '',
        publicUrl: (env.R2_PUBLIC_URL || '').replace(/\/$/, ''),
      },
    },
    sentryDsn: env.SENTRY_DSN || '',
    // During the closed beta, sign-up requires one of these codes. Empty = open sign-up.
    inviteCodes: list(env.BETA_INVITE_CODES),
    minAge: num(env.MIN_AGE, 18),
    // Emergency switch: everyone can read, nobody can change anything.
    readOnly: env.READ_ONLY === '1',
    // Check new passwords against Have I Been Pwned (k-anonymity: only 5 hash characters leave the server).
    checkBreachedPasswords: env.CHECK_BREACHED_PASSWORDS ? env.CHECK_BREACHED_PASSWORDS === '1' : isProd,
    rateLimits: {
      loginPerIp: [20, 15 * 60],
      loginFailuresPerAccount: [5, 15 * 60],
      signupPerIp: [3, 60 * 60],
      emailPerAccount: [3, 60 * 60],
      postsPerUser: [20, 24 * 60 * 60],
      uploadsPerUser: [15, 24 * 60 * 60],
      reportsPerUser: [10, 60 * 60],
    },
  };

  if (isProd) {
    const missing = [];
    if (!env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!env.APP_URL) missing.push('APP_URL');
    if (!env.APP_SECRET || env.APP_SECRET.length < 32) missing.push('APP_SECRET (32+ random characters)');
    if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (!env.EMAIL_FROM) missing.push('EMAIL_FROM');
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL']) {
      if (!env[key]) missing.push(key);
    }
    if (missing.length) {
      throw new Error(`FilmHouse won't start in production without these settings:\n  - ${missing.join('\n  - ')}`);
    }
    if (!config.appUrl.startsWith('https://')) throw new Error('APP_URL must start with https:// in production.');
  }
  return config;
}

module.exports = { loadConfig };
