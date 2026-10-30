const express = require('express');

const router = express.Router();

// Policy pages. The text is a draft for legal review before public launch.
const PAGES = {
  privacy: 'Privacy policy',
  terms: 'Terms of use',
  guidelines: 'Community guidelines',
};

for (const [slug, title] of Object.entries(PAGES)) {
  router.get(`/${slug}`, (req, res) => res.render(`pages/${slug}`, { title }));
}

module.exports = router;
