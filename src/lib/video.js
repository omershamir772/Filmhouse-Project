// Films are embedded from YouTube or Vimeo rather than uploaded, to keep server load low.

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{5,12}$/;

/**
 * Parse a YouTube or Vimeo URL into { provider, id }, or return null if unsupported.
 */
function parseVideoUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') return youtube(parts[0]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.searchParams.has('v')) return youtube(url.searchParams.get('v'));
    if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) return youtube(parts[1]);
    return null;
  }
  if (host === 'vimeo.com') {
    // vimeo.com/123456, vimeo.com/channels/staffpicks/123456, vimeo.com/showcase/x/video/123456
    const id = [...parts].reverse().find((p) => VIMEO_ID.test(p));
    return id ? { provider: 'vimeo', id } : null;
  }
  if (host === 'player.vimeo.com' && parts[0] === 'video') {
    return VIMEO_ID.test(parts[1] || '') ? { provider: 'vimeo', id: parts[1] } : null;
  }
  return null;
}

function youtube(id) {
  return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', id } : null;
}

function embedUrl(provider, id) {
  if (provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${id}`;
  if (provider === 'vimeo') return `https://player.vimeo.com/video/${id}?dnt=1`;
  return null;
}

// Vimeo thumbnails need an API call, so only YouTube gets a poster image; Vimeo falls back to a styled card.
function thumbnailUrl(provider, id) {
  return provider === 'youtube' ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

module.exports = { parseVideoUrl, embedUrl, thumbnailUrl };
