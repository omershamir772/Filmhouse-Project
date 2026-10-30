// Shared vocabulary for the platform.

// Where someone is in their career. Shown as a badge on every profile.
const MEMBER_STATUSES = ['Student', 'Freelancer', 'Alumni', 'Institution'];

// Credits every film must carry before it can be published.
const REQUIRED_ROLES = ['Director', 'Cinematographer', 'Editor'];

// Optional credits a filmmaker can add on top of the required ones.
const OPTIONAL_ROLES = [
  'Producer',
  'Writer',
  'Gaffer / Lighting',
  'Production Design / Art',
  'Sound',
  'Composer',
  'Colorist',
  'Costume',
  'Makeup',
  'Assistant Director',
  'Actor',
];

const ALL_ROLES = [...REQUIRED_ROLES, ...OPTIONAL_ROLES];

// Bulletin board post types.
const POST_TYPES = {
  crew_call: 'Crew call',
  available: 'Available for work',
};

// Recommendations must be long enough to be a real critique.
const MIN_RECOMMENDATION_WORDS = 200;

module.exports = {
  MEMBER_STATUSES,
  REQUIRED_ROLES,
  OPTIONAL_ROLES,
  ALL_ROLES,
  POST_TYPES,
  MIN_RECOMMENDATION_WORDS,
};
