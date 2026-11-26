const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const router = express.Router();
const MANIFEST = path.join(__dirname, '..', '..', 'public', 'map', '.vite', 'manifest.json');

// The map is a separate React app (see /map), built into public/map by `npm run build`.
let cached = null;
function mapAssets(isProd) {
  if (cached && isProd) return cached;
  try {
    const entry = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))['index.html'];
    cached = { script: `/static/map/${entry.file}`, styles: (entry.css || []).map((f) => `/static/map/${f}`) };
    return cached;
  } catch {
    return null;
  }
}

router.get('/map', (req, res) => {
  const assets = mapAssets(req.app.locals.config.isProd);
  if (!assets) {
    return res.status(503).render('error', { title: 'Map not built yet', message: 'Run `npm run build` to build the world map, then reload this page.' });
  }
  const context = {
    user: req.user ? { username: req.user.username, displayName: req.user.display_name } : null,
    siteUrl: '',
  };
  // The globe library injects small <style> blocks for its tooltips, so this page (only) allows
  // inline styles. Scripts stay locked to our own files.
  const csp = res.get('Content-Security-Policy');
  if (csp) res.set('Content-Security-Policy', csp.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"));
  // Embedded as inert JSON; "<" is escaped so the data can never close the script tag.
  const contextJson = JSON.stringify(context).replace(/</g, '\\u003c');
  res.render('map', { assets, contextJson });
});

module.exports = router;
