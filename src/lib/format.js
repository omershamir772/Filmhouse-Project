// View helpers, exposed to every template via app.locals.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// SQLite stores UTC timestamps as "YYYY-MM-DD HH:MM:SS".
function parseDbDate(s) {
  if (!s) return null;
  return new Date(/T|Z/.test(s) ? s : s.replace(' ', 'T') + 'Z');
}

function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function fmtRange(start, end) {
  if (!start && !end) return 'Dates flexible';
  if (start && end && start !== end) return `${fmtDate(start)} – ${fmtDate(end)}`;
  return fmtDate(start || end);
}

function timeAgo(s) {
  const date = parseDbDate(s);
  if (!date) return '';
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// Split long text into paragraphs for display (escaping is still done by the template).
function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function excerpt(text, words = 40) {
  const parts = String(text || '').trim().split(/\s+/);
  return parts.length <= words ? parts.join(' ') : parts.slice(0, words).join(' ') + '…';
}

module.exports = { fmtDate, fmtRange, timeAgo, initials, paragraphs, excerpt };
