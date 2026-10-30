// Shared helpers for blocking, reporting and admin actions.

const REPORT_TARGETS = {
  user: { table: 'users', owner: 'id', label: 'Profile' },
  film: { table: 'films', owner: 'owner_id', label: 'Film' },
  recommendation: { table: 'recommendations', owner: 'author_id', label: 'Recommendation' },
  post: { table: 'board_posts', owner: 'author_id', label: 'Bulletin' },
  photo: { table: 'set_photos', owner: 'author_id', label: 'Set photo' },
};

const REPORT_REASONS = ['Spam or scam', 'Harassment or hate', 'Unsafe or misleading gig', 'Stolen work or false credit', 'Explicit content', 'Something else'];

// Ids of people this user has blocked; their content is hidden from the user.
async function blockedIds(db, user) {
  if (!user) return new Set();
  const rows = await db.query('SELECT blocked_id FROM blocks WHERE blocker_id = $1', [user.id]);
  return new Set(rows.map((r) => r.blocked_id));
}

async function audit(db, actor, action, targetType, targetId, details = '') {
  await db.query('INSERT INTO audit_log (actor_id, actor_name, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5, $6)', [
    actor.id,
    actor.username,
    action,
    targetType,
    targetId,
    details,
  ]);
}

module.exports = { REPORT_TARGETS, REPORT_REASONS, blockedIds, audit };
