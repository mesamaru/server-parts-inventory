const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../db');

function decorate(db, server) {
  const active = db.assignments.filter((a) => a.server_id === server.id && a.removed_at === null);
  return { ...server, current_parts_count: active.length };
}

router.get('/', (req, res) => {
  const db = readDB();
  let servers = db.servers.map((s) => decorate(db, s));
  const { q } = req.query;
  if (q) {
    const qq = String(q).toLowerCase();
    servers = servers.filter((s) =>
      [s.name, s.location, s.notes].some((v) => v && String(v).toLowerCase().includes(qq))
    );
  }
  servers.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  res.json(servers);
});

router.get('/:id', (req, res) => {
  const db = readDB();
  const server = db.servers.find((s) => s.id === Number(req.params.id));
  if (!server) return res.status(404).json({ error: 'サーバーが見つかりません' });

  const currentConfig = db.assignments
    .filter((a) => a.server_id === server.id && a.removed_at === null)
    .map((a) => {
      const part = db.parts.find((p) => p.id === a.part_id);
      return {
        assignment_id: a.id,
        part_id: a.part_id,
        category: part ? part.category : a.part_category_snapshot,
        name: part ? part.name : a.part_name_snapshot,
        spec: part ? part.spec : '',
        serial_number: part ? part.serial_number : '',
        installed_at: a.installed_at,
        notes: a.notes,
        part_deleted: !part,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category, 'ja') || a.name.localeCompare(b.name, 'ja'));

  const history = db.assignments
    .filter((a) => a.server_id === server.id)
    .sort((a, b) => new Date(b.installed_at) - new Date(a.installed_at))
    .map((a) => {
      const part = db.parts.find((p) => p.id === a.part_id);
      return {
        assignment_id: a.id,
        category: part ? part.category : a.part_category_snapshot,
        name: part ? part.name : a.part_name_snapshot,
        installed_at: a.installed_at,
        removed_at: a.removed_at,
        notes: a.notes,
      };
    });

  res.json({ ...decorate(db, server), current_config: currentConfig, history });
});

router.post('/', (req, res) => {
  const db = readDB();
  const { name, location, status, notes } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'サーバー名は必須です' });
  const now = new Date().toISOString();
  const server = {
    id: nextId(db, 'servers'),
    name: String(name).trim(),
    location: location ? String(location).trim() : '',
    status: status ? String(status).trim() : '稼働中',
    notes: notes ? String(notes).trim() : '',
    created_at: now,
    updated_at: now,
  };
  db.servers.push(server);
  writeDB(db);
  res.status(201).json(decorate(db, server));
});

router.put('/:id', (req, res) => {
  const db = readDB();
  const server = db.servers.find((s) => s.id === Number(req.params.id));
  if (!server) return res.status(404).json({ error: 'サーバーが見つかりません' });
  const { name, location, status, notes } = req.body || {};
  if (name !== undefined) server.name = String(name).trim();
  if (location !== undefined) server.location = String(location).trim();
  if (status !== undefined) server.status = String(status).trim();
  if (notes !== undefined) server.notes = String(notes).trim();
  server.updated_at = new Date().toISOString();
  writeDB(db);
  res.json(decorate(db, server));
});

router.delete('/:id', (req, res) => {
  const db = readDB();
  const idx = db.servers.findIndex((s) => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'サーバーが見つかりません' });
  const hasActive = db.assignments.some((a) => a.server_id === db.servers[idx].id && a.removed_at === null);
  if (hasActive) {
    return res.status(400).json({ error: 'このサーバーにはパーツが割り当てられています。先にすべて取り外してください。' });
  }
  db.servers.splice(idx, 1);
  writeDB(db);
  res.status(204).end();
});

module.exports = router;
