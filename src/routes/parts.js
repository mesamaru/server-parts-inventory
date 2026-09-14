const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../db');

const STATUS_ALIASES = {
  '正常': 'normal', normal: 'normal',
  '故障': 'broken', broken: 'broken',
  '廃棄': 'retired', retired: 'retired',
};

function resolveStatus(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 'normal';
  const key = String(raw).trim().toLowerCase();
  const alias = STATUS_ALIASES[String(raw).trim()] || STATUS_ALIASES[key];
  return alias || null;
}

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
  const resolvedStatus = resolveStatus(status);
  if (!resolvedStatus) return res.status(400).json({ error: '不正なステータスです' });
  const now = new Date().toISOString();
  const part = {
    id: nextId(db, 'parts'),
    category: String(category).trim(),
    name: String(name).trim(),
    spec: spec ? String(spec).trim() : '',
    serial_number: serial_number ? String(serial_number).trim() : '',
    status: resolvedStatus,
    purchase_date: purchase_date || null,
    notes: notes ? String(notes).trim() : '',
    created_at: now,
    updated_at: now,
  };
  db.parts.push(part);
  writeDB(db);
  res.status(201).json(decorate(db, part));
});

// CSV等からの一括登録用。1件ずつバリデーションし、有効な行だけまとめて登録する。
router.post('/bulk', (req, res) => {
  const db = readDB();
  const { parts } = req.body || {};
  if (!Array.isArray(parts) || !parts.length) {
    return res.status(400).json({ error: '登録するパーツのデータがありません' });
  }
  const now = new Date().toISOString();
  const toCreate = [];
  const errors = [];

  parts.forEach((raw, idx) => {
    const rowNo = idx + 1;
    const category = raw && raw.category ? String(raw.category).trim() : '';
    const name = raw && raw.name ? String(raw.name).trim() : '';
    if (!category) return errors.push({ row: rowNo, error: 'カテゴリが空です' });
    if (!name) return errors.push({ row: rowNo, error: '名称が空です' });
    const resolvedStatus = resolveStatus(raw.status);
    if (!resolvedStatus) return errors.push({ row: rowNo, error: `不正なステータスです: ${raw.status}` });
    toCreate.push({
      id: nextId(db, 'parts'),
      category,
      name,
      spec: raw.spec ? String(raw.spec).trim() : '',
      serial_number: raw.serial_number ? String(raw.serial_number).trim() : '',
      status: resolvedStatus,
      purchase_date: raw.purchase_date ? String(raw.purchase_date).trim() : null,
      notes: raw.notes ? String(raw.notes).trim() : '',
      created_at: now,
      updated_at: now,
    });
  });

  if (toCreate.length) {
    db.parts.push(...toCreate);
    writeDB(db);
  }

  res.status(errors.length && !toCreate.length ? 400 : 201).json({
    created: toCreate.map((p) => decorate(db, p)),
    errors,
  });
});

// 複数パーツのカテゴリ／ステータスをまとめて変更する（空欄の項目は変更しない）
router.post('/bulk-edit', (req, res) => {
  const db = readDB();
  const { ids, category, status } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: '対象パーツがありません' });
  }
  let resolvedStatus;
  if (status !== undefined && status !== '') {
    resolvedStatus = resolveStatus(status);
    if (!resolvedStatus) return res.status(400).json({ error: '不正なステータスです' });
  }
  const trimmedCategory = category && String(category).trim();
  const now = new Date().toISOString();
  const updated = [];
  const errors = [];
  ids.forEach((rawId) => {
    const id = Number(rawId);
    const part = db.parts.find((p) => p.id === id);
    if (!part) { errors.push({ id, error: 'パーツが見つかりません' }); return; }
    if (trimmedCategory) part.category = trimmedCategory;
    if (resolvedStatus) part.status = resolvedStatus;
    part.updated_at = now;
    updated.push(id);
  });
  if (updated.length) writeDB(db);
  res.json({ updated: updated.map((id) => decorate(db, db.parts.find((p) => p.id === id))), errors });
});

// 複数パーツをまとめて削除する（割り当て中のものは失敗として報告する）
router.post('/bulk-delete', (req, res) => {
  const db = readDB();
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: '対象パーツがありません' });
  }
  const deleted = [];
  const errors = [];
  ids.forEach((rawId) => {
    const id = Number(rawId);
    const idx = db.parts.findIndex((p) => p.id === id);
    if (idx === -1) { errors.push({ id, error: 'パーツが見つかりません' }); return; }
    if (findActiveAssignment(db, id)) {
      errors.push({ id, error: '割り当て中のため削除できません' });
      return;
    }
    db.parts.splice(idx, 1);
    deleted.push(id);
  });
  if (deleted.length) writeDB(db);
  res.json({ deleted, errors });
});

router.put('/:id', (req, res) => {
  const db = readDB();
  const part = db.parts.find((p) => p.id === Number(req.params.id));
  if (!part) return res.status(404).json({ error: 'パーツが見つかりません' });
  const { category, name, spec, serial_number, status, purchase_date, notes } = req.body || {};
  let resolvedStatus;
  if (status !== undefined) {
    resolvedStatus = resolveStatus(status);
    if (!resolvedStatus) return res.status(400).json({ error: '不正なステータスです' });
  }
  if (category !== undefined) part.category = String(category).trim();
  if (name !== undefined) part.name = String(name).trim();
  if (spec !== undefined) part.spec = String(spec).trim();
  if (serial_number !== undefined) part.serial_number = String(serial_number).trim();
  if (resolvedStatus !== undefined) part.status = resolvedStatus;
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
