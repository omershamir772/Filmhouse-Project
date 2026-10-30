// Outgoing email. Uses Resend's HTTP API when configured; otherwise prints to the console so
// verification and reset links can be followed in development. `outbox` keeps sent mail for tests.

function createMailer({ resendApiKey, from }, { log = console.log } = {}) {
  const outbox = [];
  return {
    outbox,
    async send({ to, subject, text }) {
      outbox.push({ to, subject, text });
      if (!resendApiKey) {
        log(`\n--- email to ${to} ---\nSubject: ${subject}\n\n${text}\n---------------------\n`);
        return;
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Email provider refused the message (${res.status})`);
    },
  };
}

module.exports = { createMailer };
