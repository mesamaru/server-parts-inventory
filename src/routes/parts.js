const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../db');

const STATUSES = ['normal', 'broken', 'retired'];

function findActiveAssignment(db, partId) {
  return db.assignments.find((a) => a.part_id === partId && a.removed_at === null);
}

function decorate(db, part) {
  const active = findActiveAssignment(db, part.id);
  const server = active ? db.servers.find((s) => s.id === active.server_id) : null;
  return {
    ...part,
    assignment_state: part.status === 'normal' ? (active ? 'assigned' : 'in_stock') : null,
    current_server_id: active ? active.server_id : null,
    current_server_name: active ? (server ? server.name : active.server_name_snapshot) : null,
    current_assignment_id: active ? active.id : null,
  };
}

router.get('/', (req, res) => {
  const db = readDB();
  let parts = db.parts.map((p) => decorate(db, p));
  const { category, status, assignment_state, q } = req.query;
  if (category) parts = parts.filter((p) => p.category === category);
  if (status) parts = parts.filter((p) => p.status === status);
  if (assignment_state) parts = parts.filter((p) => p.assignment_state === assignment_state);
  if (q) {
    const qq = String(q).toLowerCase();
    parts = parts.filter((p) =>
      [p.name, p.spec, p.serial_number, p.notes, p.category].some(
        (v) => v && String(v).toLowerCase().includes(qq)
      )
    );
  }
  parts.sort((a, b) => a.category.localeCompare(b.category, 'ja') || a.name.localeCompare(b.name, 'ja'));
  res.json(parts);
});

router.get('/:id', (req, res) => {
  const db = readDB();
  const part = db.parts.find((p) => p.id === Number(req.params.id));
  if (!part) return res.status(404).json({ error: 'パーツが見つかりません' });
  const history = db.assignments
    .filter((a) => a.part_id === part.id)
    .sort((a, b) => new Date(b.installed_at) - new Date(a.installed_at))
    .map((a) => {
      const server = db.servers.find((s) => s.id === a.server_id);
      return { ...a, server_name: server ? server.name : a.server_name_snapshot };
    });
  res.json({ ...decorate(db, part), history });
});

router.post('/', (req, res) => {
  const db = readDB();
  const { category, name, spec, serial_number, status, purchase_date, notes } = req.body || {};
  if (!category || !String(category).trim()) return res.status(400).json({ error: 'カテゴリは必須です' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: '名称は必須です' });
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: '不正なステータスです' });
  const now = new Date().toISOString();
  const part = {
    id: nextId(db, 'parts'),
    category: String(category).trim(),
    name: String(name).trim(),
    spec: spec ? String(spec).trim() : '',
    serial_number: serial_number ? String(serial_number).trim() : '',
    status: status || 'normal',
    purchase_date: purchase_date || null,
    notes: notes ? String(notes).trim() : '',
    created_at: now,
    updated_at: now,
  };
  db.parts.push(part);
  writeDB(db);
  res.status(201).json(decorate(db, part));
});

router.put('/:id', (req, res) => {
  const db = readDB();
  const part = db.parts.find((p) => p.id === Number(req.params.id));
  if (!part) return res.status(404).json({ error: 'パーツが見つかりません' });
  const { category, name, spec, serial_number, status, purchase_date, notes } = req.body || {};
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: '不正なステータスです' });
  if (category !== undefined) part.category = String(category).trim();
  if (name !== undefined) part.name = String(name).trim();
  if (spec !== undefined) part.spec = String(spec).trim();
  if (serial_number !== undefined) part.serial_number = String(serial_number).trim();
  if (status !== undefined) part.status = status;
  if (purchase_date !== undefined) part.purchase_date = purchase_date || null;
  if (notes !== undefined) part.notes = String(notes).trim();
  part.updated_at = new Date().toISOString();
  writeDB(db);
  res.json(decorate(db, part));
});

router.delete('/:id', (req, res) => {
  const db = readDB();
  const idx = db.parts.findIndex((p) => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'パーツが見つかりません' });
  const hasActive = findActiveAssignment(db, db.parts[idx].id);
  if (hasActive) {
    return res.status(400).json({ error: 'このパーツは現在サーバーに割り当て中です。先に取り外してください。' });
  }
  db.parts.splice(idx, 1);
  writeDB(db);
  res.status(204).end();
});

module.exports = router;
