const { nextId } = require('./db');

// 際限なく増えないよう直近この件数だけ残す
const MAX_LOGS = 5000;

// 削除済み（ゴミ箱に入っている）レコードを除いたものを返すヘルパー
const activeParts = (db) => db.parts.filter((p) => !p.deleted_at);
const activeServers = (db) => db.servers.filter((s) => !s.deleted_at);
const findActivePart = (db, id) => db.parts.find((p) => p.id === Number(id) && !p.deleted_at);
const findActiveServer = (db, id) => db.servers.find((s) => s.id === Number(id) && !s.deleted_at);

function logAction(db, req, entry) {
  db.audit_logs.push({
    id: nextId(db, 'audit_logs'),
    at: new Date().toISOString(),
    user: req && req.user ? req.user.username : 'system',
    action: entry.action,
    target_type: entry.target_type || '',
    target_id: entry.target_id === undefined ? null : entry.target_id,
    target_name: entry.target_name || '',
    detail: entry.detail || '',
  });
  if (db.audit_logs.length > MAX_LOGS) {
    db.audit_logs = db.audit_logs.slice(-MAX_LOGS);
  }
}

module.exports = {
  logAction,
  activeParts,
  activeServers,
  findActivePart,
  findActiveServer,
};
