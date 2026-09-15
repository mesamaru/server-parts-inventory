const express = require('express');
const router = express.Router();
const { readDB, writeDB } = require('../db');
const { logAction } = require('../audit');
const { requireAdmin } = require('../auth');

const COLLECTIONS = {
  parts: { key: 'parts', label: 'パーツ', action: 'part' },
  servers: { key: 'servers', label: 'サーバー', action: 'server' },
};

function deletedItems(db, key) {
  return db[key]
    .filter((item) => item.deleted_at)
    .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
}

router.get('/', (req, res) => {
  const db = readDB();
  res.json({
    parts: deletedItems(db, 'parts'),
    servers: deletedItems(db, 'servers'),
  });
});

router.post('/:type/:id/restore', (req, res) => {
  const meta = COLLECTIONS[req.params.type];
  if (!meta) return res.status(404).json({ error: '不明な種別です' });
  const db = readDB();
  const item = db[meta.key].find((x) => x.id === Number(req.params.id) && x.deleted_at);
  if (!item) return res.status(404).json({ error: `ゴミ箱に該当の${meta.label}がありません` });
  item.deleted_at = null;
  item.updated_at = new Date().toISOString();
  logAction(db, req, {
    action: `${meta.action}.restore`,
    target_type: meta.action,
    target_id: item.id,
    target_name: item.name,
  });
  writeDB(db);
  res.json(item);
});

// 完全削除は元に戻せないため管理者のみ
router.delete('/:type/:id', requireAdmin, (req, res) => {
  const meta = COLLECTIONS[req.params.type];
  if (!meta) return res.status(404).json({ error: '不明な種別です' });
  const db = readDB();
  const idx = db[meta.key].findIndex((x) => x.id === Number(req.params.id) && x.deleted_at);
  if (idx === -1) return res.status(404).json({ error: `ゴミ箱に該当の${meta.label}がありません` });
  const [removed] = db[meta.key].splice(idx, 1);
  logAction(db, req, {
    action: `${meta.action}.purge`,
    target_type: meta.action,
    target_id: removed.id,
    target_name: removed.name,
    detail: '完全削除',
  });
  writeDB(db);
  res.status(204).end();
});

module.exports = router;
