const express = require('express');
const router = express.Router();
const { readDB } = require('../db');
const { activeParts, activeServers } = require('../audit');

router.get('/', (req, res) => {
  const db = readDB();
  const parts = activeParts(db);
  const servers = activeServers(db);
  const assignedPartIds = new Set(
    db.assignments.filter((a) => a.removed_at === null).map((a) => a.part_id)
  );

  const isInStock = (p) => p.status === 'normal' && !assignedPartIds.has(p.id);

  const summary = {
    total: parts.length,
    in_stock: parts.filter(isInStock).length,
    assigned: parts.filter((p) => assignedPartIds.has(p.id)).length,
    broken: parts.filter((p) => p.status === 'broken').length,
    retired: parts.filter((p) => p.status === 'retired').length,
    servers: servers.length,
    trashed: db.parts.filter((p) => p.deleted_at).length,
    pending_sync: db.sync_reports.length,
  };

  const byCategory = new Map();
  parts.forEach((p) => {
    if (!byCategory.has(p.category)) {
      byCategory.set(p.category, { category: p.category, total: 0, in_stock: 0, assigned: 0, broken: 0 });
    }
    const row = byCategory.get(p.category);
    row.total++;
    if (assignedPartIds.has(p.id)) row.assigned++;
    else if (isInStock(p)) row.in_stock++;
    if (p.status === 'broken') row.broken++;
  });

  const serverRows = servers
    .map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      location: s.location,
      parts: db.assignments.filter((a) => a.server_id === s.id && a.removed_at === null).length,
    }))
    .sort((a, b) => b.parts - a.parts || a.name.localeCompare(b.name, 'ja'));

  const recent = [...db.audit_logs]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10);

  // 保証期限が切れている / 30日以内に切れるパーツ
  const today = new Date();
  const soonLimit = new Date(today.getTime() + 30 * 86400000);
  const warranty = parts
    .filter((p) => p.warranty_until)
    .map((p) => ({
      id: p.id,
      category: p.category,
      name: p.name,
      maker: p.maker || '',
      warranty_until: p.warranty_until,
      expired: new Date(p.warranty_until) < today,
    }))
    .filter((p) => p.expired || new Date(p.warranty_until) <= soonLimit)
    .sort((a, b) => new Date(a.warranty_until) - new Date(b.warranty_until));

  summary.warranty_alerts = warranty.length;

  res.json({
    summary,
    categories: [...byCategory.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, 'ja')),
    servers: serverRows,
    warranty,
    recent,
  });
});

module.exports = router;
