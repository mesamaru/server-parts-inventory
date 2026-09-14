const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../db');

function findActiveAssignment(db, partId) {
  return db.assignments.find((a) => a.part_id === partId && a.removed_at === null);
}

// パーツをサーバーに割り当てる（在庫 -> 使用中）
router.post('/', (req, res) => {
  const db = readDB();
  const { part_id, server_id, installed_at, notes } = req.body || {};
  const part = db.parts.find((p) => p.id === Number(part_id));
  const server = db.servers.find((s) => s.id === Number(server_id));
  if (!part) return res.status(400).json({ error: 'パーツが見つかりません' });
  if (!server) return res.status(400).json({ error: 'サーバーが見つかりません' });
  if (part.status !== 'normal') {
    return res.status(400).json({ error: `このパーツはステータスが「${part.status}」のため割り当てできません` });
  }
  if (findActiveAssignment(db, part.id)) {
    return res.status(409).json({ error: 'このパーツは既に別のサーバーに割り当て済みです。先に取り外すか、移動を使ってください。' });
  }
  const now = new Date().toISOString();
  const assignment = {
    id: nextId(db, 'assignments'),
    part_id: part.id,
    server_id: server.id,
    part_name_snapshot: part.name,
    part_category_snapshot: part.category,
    server_name_snapshot: server.name,
    installed_at: installed_at || now,
    removed_at: null,
    notes: notes ? String(notes).trim() : '',
  };
  db.assignments.push(assignment);
  writeDB(db);
  res.status(201).json(assignment);
});

// 取り外す（使用中 -> 在庫）
router.post('/:id/remove', (req, res) => {
  const db = readDB();
  const assignment = db.assignments.find((a) => a.id === Number(req.params.id));
  if (!assignment) return res.status(404).json({ error: '割り当てが見つかりません' });
  if (assignment.removed_at !== null) return res.status(400).json({ error: '既に取り外し済みです' });
  const { removed_at, notes } = req.body || {};
  assignment.removed_at = removed_at || new Date().toISOString();
  if (notes !== undefined) assignment.notes = String(notes).trim();
  writeDB(db);
  res.json(assignment);
});

// 別サーバーへ移動する（現在の割り当てを閉じて新規作成）
router.post('/:id/move', (req, res) => {
  const db = readDB();
  const current = db.assignments.find((a) => a.id === Number(req.params.id));
  if (!current) return res.status(404).json({ error: '割り当てが見つかりません' });
  if (current.removed_at !== null) return res.status(400).json({ error: '既に取り外し済みの割り当てです' });
  const { server_id, notes } = req.body || {};
  const newServer = db.servers.find((s) => s.id === Number(server_id));
  if (!newServer) return res.status(400).json({ error: '移動先サーバーが見つかりません' });
  if (newServer.id === current.server_id) return res.status(400).json({ error: '移動先が現在と同じサーバーです' });

  const now = new Date().toISOString();
  current.removed_at = now;

  const part = db.parts.find((p) => p.id === current.part_id);
  const newAssignment = {
    id: nextId(db, 'assignments'),
    part_id: current.part_id,
    server_id: newServer.id,
    part_name_snapshot: part ? part.name : current.part_name_snapshot,
    part_category_snapshot: part ? part.category : current.part_category_snapshot,
    server_name_snapshot: newServer.name,
    installed_at: now,
    removed_at: null,
    notes: notes ? String(notes).trim() : '',
  };
  db.assignments.push(newAssignment);
  writeDB(db);
  res.status(201).json({ closed: current, created: newAssignment });
});

module.exports = router;
