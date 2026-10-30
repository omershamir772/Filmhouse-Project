const { loadConfig } = require('./config');
const { openDb, migrate } = require('./db');
const { createApp } = require('./app');

const HOUR = 60 * 60 * 1000;

async function main() {
  const config = loadConfig();

  let onError = () => {};
  if (config.sentryDsn) {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.env,
      sendDefaultPii: false,
      // Never send cookies, form bodies or headers: they can hold passwords and session tokens.
      beforeSend(event) {
        if (event.request) event.request = { url: event.request.url, method: event.request.method };
        return event;
      },
    });
    onError = (err) => Sentry.captureException(err);
  }

  const db = await openDb(config.databaseUrl);
  await migrate(db, { log: console.log });

  const app = createApp({ config, db, onError });
  const server = app.listen(config.port, () => {
    console.log(`FilmHouse is screening at ${config.appUrl} (${config.env})`);
  });
  // Drop slow or stalled requests instead of holding connections open.
  server.requestTimeout = 30_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 65_000; // longer than the load balancer's idle timeout

  // Housekeeping: expired sessions, used links and old rate-limit windows.
  const cleanUp = async () => {
    try {
      await db.query('DELETE FROM sessions WHERE expires_at < now()');
      await db.query("DELETE FROM email_tokens WHERE expires_at < now() - interval '1 day'");
      await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
    } catch (err) {
      onError(err);
      console.error('Clean-up failed:', err.message);
    }
  };
  cleanUp();
  setInterval(cleanUp, HOUR).unref();

  const shutdown = () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
