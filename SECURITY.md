# Security

## Reporting a vulnerability

Please email **security@filmhouse.example** *(to be set up)* rather than opening a public issue. We'll reply within 3 working days.

## How FilmHouse protects members

| Area | Protection |
| --- | --- |
| Passwords | scrypt with per-user salt; 10+ characters; can't contain the username; checked against known breaches (Have I Been Pwned, k-anonymity) |
| Sign-in | Rate limits per IP and per account; same response time whether or not an account exists; account lockout after repeated failures |
| Sessions | 256-bit random tokens, stored only as SHA-256 hashes; `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefixed cookies; all sessions revoked on password reset; "sign out everywhere" |
| Accounts | Email verification before posting; single-use, expiring links for verification and reset; old address notified on email change; suspended accounts lose all sessions |
| Forms | CSRF token on every state-changing request, including uploads |
| Injection | Parameterised SQL everywhere; auto-escaped templates; strict Content-Security-Policy (no inline scripts) |
| Transport | HTTPS only, HSTS, Cloudflare in front |
| Uploads | Real image decoding (the browser's claimed type is ignored), pixel limit, re-encoded to WebP so all metadata including **GPS location** is removed, stored under random names on a separate domain (R2) |
| Abuse | Report button everywhere; admin hide/suspend tools; blocking; audit log of every admin action; daily posting and upload limits; optional invite codes |
| Privacy | Only essential cookies; view counts use a daily-rotating keyed hash instead of IPs; data export and account deletion in settings |
| Infrastructure | Database not reachable from the internet; daily backups; secrets only in host environment settings; production refuses to start without them |
| Supply chain | `npm audit` and secret scanning in CI; Dependabot updates |
| Emergencies | `READ_ONLY=1` freezes all changes while keeping the site readable |

## Incident response

1. **Contain:** set `READ_ONLY=1` in Render and redeploy (about 1 minute). For a compromised account, suspend it from `/admin`.
2. **Rotate:** anything that may have leaked, i.e. `APP_SECRET` (this signs everyone out), the database password, R2 keys, the Resend key and the Sentry DSN.
3. **Investigate:** check Render logs, Sentry, the `/admin` audit log, and GitHub's security tab.
4. **Restore:** if data was damaged, use Render's point-in-time recovery to just before the incident.
5. **Notify:** if personal data was exposed, inform affected members and Israel's Privacy Protection Authority (and EU authorities, if EU members are affected) as the law requires. GDPR's limit is 72 hours.
6. **Learn:** write a short blameless summary, and add a test or check so it can't happen the same way twice.
