const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../db');
const { logAction, activeParts, findActivePart } = require('../audit');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
const PHOTO_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

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

// 同名クエリを複数指定できる（例: ?category=CPU&category=メモリ）
function queryValues(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function decorate(db, part) {
  const active = findActiveAssignment(db, part.id);
  const server = active ? db.servers.find((s) => s.id === active.server_id) : null;
  return {
    ...part,
    // 「状態」は物理的な所在、「ステータス」は状態(正常/故障/廃棄)で独立。
    // 故障品でも割り当て中なら取り外せるよう、statusとは切り離して判定する。
    assignment_state: active ? 'assigned' : 'in_stock',
    current_server_id: active ? active.server_id : null,
    current_server_name: active ? (server ? server.name : active.server_name_snapshot) : null,
    current_assignment_id: active ? active.id : null,
  };
}

router.get('/', (req, res) => {
  const db = readDB();
  let parts = activeParts(db).map((p) => decorate(db, p));
  const { category, status, assignment_state, q } = req.query;
  const categories = queryValues(category);
  const statuses = queryValues(status);
  const states = queryValues(assignment_state);
  if (categories.length) parts = parts.filter((p) => categories.includes(p.category));
  if (statuses.length) parts = parts.filter((p) => statuses.includes(p.status));
  if (states.length) parts = parts.filter((p) => states.includes(p.assignment_state));
  if (q) {
    const qq = String(q).toLowerCase();
    parts = parts.filter((p) =>
      [p.name, p.spec, p.serial_number, p.notes, p.category, p.maker].some(
        (v) => v && String(v).toLowerCase().includes(qq)
      )
    );
  }
  parts.sort((a, b) => a.category.localeCompare(b.category, 'ja') || a.name.localeCompare(b.name, 'ja'));
  res.json(parts);
});

// フィルタ用。絞り込み結果ではなく全パーツからカテゴリ一覧を作る
router.get('/categories', (req, res) => {
  const db = readDB();
  const categories = [...new Set(activeParts(db).map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'ja'));
  res.json(categories);
});

router.get('/:id', (req, res) => {
  const db = readDB();
  const part = findActivePart(db, req.params.id);
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
  const { category, name, maker, spec, serial_number, status, purchase_date, warranty_until, notes } = req.body || {};
  if (!category || !String(category).trim()) return res.status(400).json({ error: 'カテゴリは必須です' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: '名称は必須です' });
  const resolvedStatus = resolveStatus(status);
  if (!resolvedStatus) return res.status(400).json({ error: '不正なステータスです' });
  const now = new Date().toISOString();
  const part = {
    id: nextId(db, 'parts'),
    category: String(category).trim(),
    name: String(name).trim(),
    maker: maker ? String(maker).trim() : '',
    spec: spec ? String(spec).trim() : '',
    serial_number: serial_number ? String(serial_number).trim() : '',
    status: resolvedStatus,
    purchase_date: purchase_date || null,
    warranty_until: warranty_until || null,
    notes: notes ? String(notes).trim() : '',
    photos: [],
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  db.parts.push(part);
  logAction(db, req, { action: 'part.create', target_type: 'part', target_id: part.id, target_name: part.name });
  writeDB(db);
  res.status(201).json(decorate(db, part));
});

// CSV等からの一括登録用。1件ずつバリデーションし、有効な行だけまとめて反映する。
// update_id が指定された行は新規登録ではなく、その既存パーツの上書き更新になる。
router.post('/bulk', (req, res) => {
  const db = readDB();
  const { parts } = req.body || {};
  if (!Array.isArray(parts) || !parts.length) {
    return res.status(400).json({ error: '登録するパーツのデータがありません' });
  }
  const now = new Date().toISOString();
  const toCreate = [];
  const updated = [];
  const errors = [];

  parts.forEach((raw, idx) => {
    const rowNo = idx + 1;
    const category = raw && raw.category ? String(raw.category).trim() : '';
    const name = raw && raw.name ? String(raw.name).trim() : '';
    if (!category) return errors.push({ row: rowNo, error: 'カテゴリが空です' });
    if (!name) return errors.push({ row: rowNo, error: '名称が空です' });
    const resolvedStatus = resolveStatus(raw.status);
    if (!resolvedStatus) return errors.push({ row: rowNo, error: `不正なステータスです: ${raw.status}` });

    const values = {
      category,
      name,
      maker: raw.maker ? String(raw.maker).trim() : '',
      spec: raw.spec ? String(raw.spec).trim() : '',
      serial_number: raw.serial_number ? String(raw.serial_number).trim() : '',
      status: resolvedStatus,
      purchase_date: raw.purchase_date ? String(raw.purchase_date).trim() : null,
      warranty_until: raw.warranty_until ? String(raw.warranty_until).trim() : null,
      notes: raw.notes ? String(raw.notes).trim() : '',
    };

    if (raw.update_id) {
      const target = findActivePart(db, raw.update_id);
      if (!target) return errors.push({ row: rowNo, error: '上書き対象のパーツが見つかりません' });
      Object.assign(target, values, { updated_at: now });
      updated.push(target);
      return;
    }

    toCreate.push({ id: nextId(db, 'parts'), ...values, photos: [], created_at: now, updated_at: now, deleted_at: null });
  });

  if (toCreate.length || updated.length) {
    db.parts.push(...toCreate);
    logAction(db, req, {
      action: 'part.bulk_import',
      target_type: 'part',
      detail: `新規${toCreate.length}件 / 上書き${updated.length}件`,
    });
    writeDB(db);
  }

  res.status(errors.length && !toCreate.length && !updated.length ? 400 : 201).json({
    created: toCreate.map((p) => decorate(db, p)),
    updated: updated.map((p) => decorate(db, p)),
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
    const part = findActivePart(db, id);
    if (!part) { errors.push({ id, error: 'パーツが見つかりません' }); return; }
    if (trimmedCategory) part.category = trimmedCategory;
    if (resolvedStatus) part.status = resolvedStatus;
    part.updated_at = now;
    updated.push(id);
  });
  if (updated.length) {
    const changes = [trimmedCategory && `カテゴリ→${trimmedCategory}`, resolvedStatus && `ステータス→${resolvedStatus}`]
      .filter(Boolean).join(' / ');
    logAction(db, req, { action: 'part.bulk_edit', target_type: 'part', detail: `${updated.length}件: ${changes}` });
    writeDB(db);
  }
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
  const now = new Date().toISOString();
  ids.forEach((rawId) => {
    const id = Number(rawId);
    const part = findActivePart(db, id);
    if (!part) { errors.push({ id, error: 'パーツが見つかりません' }); return; }
    if (findActiveAssignment(db, id)) {
      errors.push({ id, error: '割り当て中のため削除できません' });
      return;
    }
    part.deleted_at = now;
    deleted.push(id);
  });
  if (deleted.length) {
    logAction(db, req, { action: 'part.bulk_delete', target_type: 'part', detail: `${deleted.length}件をゴミ箱へ移動` });
    writeDB(db);
  }
  res.json({ deleted, errors });
});

/* ---- 写真（data/uploads に保存し、パーツにファイル名だけ持たせる） ---- */

router.post('/:id/photos', (req, res) => {
  const db = readDB();
  const part = findActivePart(db, req.params.id);
  if (!part) return res.status(404).json({ error: 'パーツが見つかりません' });

  const { content_type, data } = req.body || {};
  const ext = PHOTO_TYPES[content_type];
  if (!ext) return res.status(400).json({ error: '画像はJPEG / PNG / WebP / GIF のみ対応しています' });
  if (!data) return res.status(400).json({ error: '画像データがありません' });

  const buffer = Buffer.from(String(data), 'base64');
  if (!buffer.length) return res.status(400).json({ error: '画像データを読み取れませんでした' });
  if (buffer.length > MAX_PHOTO_BYTES) {
    return res.status(400).json({ error: '画像は5MBまでです' });
  }

  // ファイル名はサーバー側で作る（クライアントの名前をパスに使わない）
  const photoId = crypto.randomBytes(12).toString('hex');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, photoId + ext), buffer);

  if (!part.photos) part.photos = [];
  part.photos.push({ id: photoId, ext, content_type, uploaded_at: new Date().toISOString() });
  part.updated_at = new Date().toISOString();
  logAction(db, req, { action: 'part.photo_add', target_type: 'part', target_id: part.id, target_name: part.name });
  writeDB(db);
  res.status(201).json({ id: photoId });
});

router.get('/:id/photos/:photoId', (req, res) => {
  const db = readDB();
  const part = findActivePart(db, req.params.id);
  if (!part) return res.status(404).json({ error: 'パーツが見つかりません' });
  const photo = (part.photos || []).find((p) => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: '画像が見つかりません' });
  const file = path.join(UPLOAD_DIR, photo.id + photo.ext);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '画像ファイルがありません' });
  res.type(photo.content_type);
  res.sendFile(file);
});

router.delete('/:id/photos/:photoId', (req, res) => {
  const db = readDB();
  const part = findActivePart(db, req.params.id);
  if (!part) return res.status(404).json({ error: 'パーツが見つかりません' });
  const idx = (part.photos || []).findIndex((p) => p.id === req.params.photoId);
  if (idx === -1) return res.status(404).json({ error: '画像が見つかりません' });
  const [photo] = part.photos.splice(idx, 1);
  const file = path.join(UPLOAD_DIR, photo.id + photo.ext);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  part.updated_at = new Date().toISOString();
  logAction(db, req, { action: 'part.photo_delete', target_type: 'part', target_id: part.id, target_name: part.name });
  writeDB(db);
  res.status(204).end();
});

router.put('/:id', (req, res) => {
  const db = readDB();
  const part = findActivePart(db, req.params.id);
  if (!part) return res.status(404).json({ error: 'パーツが見つかりません' });
  const { category, name, maker, spec, serial_number, status, purchase_date, warranty_until, notes } = req.body || {};
  let resolvedStatus;
  if (status !== undefined) {
    resolvedStatus = resolveStatus(status);
    if (!resolvedStatus) return res.status(400).json({ error: '不正なステータスです' });
  }
  if (category !== undefined) part.category = String(category).trim();
  if (name !== undefined) part.name = String(name).trim();
  if (maker !== undefined) part.maker = String(maker).trim();
  if (spec !== undefined) part.spec = String(spec).trim();
  if (serial_number !== undefined) part.serial_number = String(serial_number).trim();
  if (resolvedStatus !== undefined) part.status = resolvedStatus;
  if (purchase_date !== undefined) part.purchase_date = purchase_date || null;
  if (warranty_until !== undefined) part.warranty_until = warranty_until || null;
  if (notes !== undefined) part.notes = String(notes).trim();
  part.updated_at = new Date().toISOString();
  logAction(db, req, { action: 'part.update', target_type: 'part', target_id: part.id, target_name: part.name });
  writeDB(db);
  res.json(decorate(db, part));
});

// 物理削除ではなくゴミ箱へ移動する（ゴミ箱から復元・完全削除できる）
router.delete('/:id', (req, res) => {
  const db = readDB();
  const part = findActivePart(db, req.params.id);
  if (!part) return res.status(404).json({ error: 'パーツが見つかりません' });
  if (findActiveAssignment(db, part.id)) {
    return res.status(400).json({ error: 'このパーツは現在サーバーに割り当て中です。先に取り外してください。' });
  }
  part.deleted_at = new Date().toISOString();
  logAction(db, req, { action: 'part.delete', target_type: 'part', target_id: part.id, target_name: part.name });
  writeDB(db);
  res.status(204).end();
});

module.exports = router;
