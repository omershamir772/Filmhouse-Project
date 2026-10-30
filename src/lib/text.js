function wordCount(text) {
  const words = String(text || '').trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return words ? words.length : 0;
}

function slugifyUsername(s) {
  return String(s || '').trim().toLowerCase();
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const LETTERBOXD_RE = /^[A-Za-z0-9_]{2,30}$/;

// Accept either a bare Letterboxd username or a full profile URL.
function parseLetterboxd(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/letterboxd\.com\/([A-Za-z0-9_]+)/i);
  const name = m ? m[1] : s.replace(/^@/, '');
  return LETTERBOXD_RE.test(name) ? name : null;
}

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function toList(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

module.exports = { wordCount, slugifyUsername, USERNAME_RE, parseLetterboxd, isIsoDate, toList };
