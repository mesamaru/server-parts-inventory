const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../db');
const { logAction, activeParts, activeServers, findActiveServer } = require('../audit');

// 実機から届いたパーツと、登録済みパーツが同一かどうかの判定。
// 双方にシリアル番号がある場合はそれだけで判断し（別個体を同一視しないため）、
// 無ければカテゴリ・名称・スペックで判断する。
function isSamePart(part, reported) {
  if (part.category !== reported.category) return false;
  if (reported.serial_number && part.serial_number) {
    return part.serial_number === reported.serial_number;
  }
  return part.name === reported.name && (part.spec || '') === (reported.spec || '');
}

function takeFromPool(pool, reported) {
  const hit = pool.find((entry) => !entry.used && entry.part && isSamePart(entry.part, reported));
  if (hit) hit.used = true;
  return hit || null;
}

// レポートは受信時の生データを保存し、差分は参照時に毎回計算する。
// こうしておけば、受信後に台帳を手で直しても差分が古くならない。
function computeDiff(db, report) {
  const assignedPool = db.assignments
    .filter((a) => a.server_id === report.server_id && a.removed_at === null)
    .map((a) => ({ assignment: a, part: db.parts.find((p) => p.id === a.part_id), used: false }));

  const assignedPartIds = new Set(
    db.assignments.filter((a) => a.removed_at === null).map((a) => a.part_id)
  );
  const stockPool = activeParts(db)
    .filter((p) => p.status === 'normal' && !assignedPartIds.has(p.id))
    .map((p) => ({ part: p, used: false }));

  const matched = [];
  const to_assign = [];
  const unregistered = [];

  report.parts.forEach((reported) => {
    const alreadyHere = takeFromPool(assignedPool, reported);
    if (alreadyHere) {
      matched.push({ reported, part_id: alreadyHere.part.id, name: alreadyHere.part.name });
      return;
    }
    const inStock = takeFromPool(stockPool, reported);
    if (inStock) {
      to_assign.push({ reported, part_id: inStock.part.id, name: inStock.part.name });
      return;
    }
    unregistered.push({ reported });
  });

  const to_remove = assignedPool
    .filter((entry) => !entry.used)
    .map((entry) => ({
      assignment_id: entry.assignment.id,
      part_id: entry.assignment.part_id,
      name: entry.part ? entry.part.name : entry.assignment.part_name_snapshot,
      category: entry.part ? entry.part.category : entry.assignment.part_category_snapshot,
      spec: entry.part ? entry.part.spec : '',
      serial_number: entry.part ? entry.part.serial_number : '',
    }));

  return { matched, to_assign, unregistered, to_remove };
}

// Proxmoxホスト等からの構成送信。APIトークンでもセッションでも受け付ける。
router.post('/report', (req, res) => {
  const db = readDB();
  const { server_name, host_info, parts } = req.body || {};
  if (!server_name || !String(server_name).trim()) {
    return res.status(400).json({ error: 'server_name は必須です' });
  }
  if (!Array.isArray(parts)) {
    return res.status(400).json({ error: 'parts は配列で送ってください' });
  }
  const name = String(server_name).trim();
  const server = activeServers(db).find((s) => s.name === name);
  if (!server) {
    return res.status(404).json({
      error: `サーバー「${name}」が登録されていません。先にサーバー一覧から登録してください。`,
      known_servers: activeServers(db).map((s) => s.name),
    });
  }

  const normalized = parts.map((p) => ({
    category: String(p.category || '').trim(),
    name: String(p.name || '').trim(),
    maker: String(p.maker || '').trim(),
    spec: String(p.spec || '').trim(),
    serial_number: String(p.serial_number || '').trim(),
    notes: String(p.notes || '').trim(),
  })).filter((p) => p.category && p.name);

  const report = {
    id: nextId(db, 'sync_reports'),
    server_id: server.id,
    server_name: server.name,
    host_info: String(host_info || '').trim(),
    created_at: new Date().toISOString(),
    parts: normalized,
  };
  // 同じサーバーの未処理レポートは最新のものだけ残す
  db.sync_reports = db.sync_reports.filter((r) => r.server_id !== server.id);
  db.sync_reports.push(report);
  logAction(db, req, {
    action: 'sync.report',
    target_type: 'server',
    target_id: server.id,
    target_name: server.name,
    detail: `${normalized.length}件の構成を受信`,
  });
  writeDB(db);

  const diff = computeDiff(db, report);
  res.status(201).json({
    report_id: report.id,
    server: server.name,
    summary: {
      matched: diff.matched.length,
      to_assign: diff.to_assign.length,
      unregistered: diff.unregistered.length,
      to_remove: diff.to_remove.length,
    },
  });
});

router.get('/reports', (req, res) => {
  const db = readDB();
  res.json(db.sync_reports
    .filter((r) => findActiveServer(db, r.server_id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((r) => ({
      id: r.id,
      server_id: r.server_id,
      server_name: r.server_name,
      host_info: r.host_info,
      created_at: r.created_at,
      diff: computeDiff(db, r),
    })));
});

router.post('/reports/:id/apply', (req, res) => {
  const db = readDB();
  const report = db.sync_reports.find((r) => r.id === Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'レポートが見つかりません' });
  const server = findActiveServer(db, report.server_id);
  if (!server) return res.status(400).json({ error: '対象サーバーが見つかりません' });

  const { remove_assignment_ids = [], assign_part_ids = [], register = [] } = req.body || {};
  const now = new Date().toISOString();
  const result = { removed: 0, assigned: 0, registered: 0, errors: [] };

  const assignPart = (part) => {
    db.assignments.push({
      id: nextId(db, 'assignments'),
      part_id: part.id,
      server_id: server.id,
      part_name_snapshot: part.name,
      part_category_snapshot: part.category,
      server_name_snapshot: server.name,
      installed_at: now,
      removed_at: null,
      notes: '構成同期により割り当て',
    });
  };

  remove_assignment_ids.forEach((rawId) => {
    const assignment = db.assignments.find((a) => a.id === Number(rawId) && a.removed_at === null);
    if (!assignment) { result.errors.push(`割り当て#${rawId}は既に取り外し済みです`); return; }
    assignment.removed_at = now;
    result.removed++;
  });

  assign_part_ids.forEach((rawId) => {
    const part = activeParts(db).find((p) => p.id === Number(rawId));
    if (!part) { result.errors.push(`パーツ#${rawId}が見つかりません`); return; }
    if (db.assignments.some((a) => a.part_id === part.id && a.removed_at === null)) {
      result.errors.push(`「${part.name}」は既に割り当て済みです`);
      return;
    }
    assignPart(part);
    result.assigned++;
  });

  register.forEach((raw) => {
    const category = String(raw.category || '').trim();
    const name = String(raw.name || '').trim();
    if (!category || !name) { result.errors.push('カテゴリと名称が必要です'); return; }
    const part = {
      id: nextId(db, 'parts'),
      category,
      name,
      maker: String(raw.maker || '').trim(),
      spec: String(raw.spec || '').trim(),
      serial_number: String(raw.serial_number || '').trim(),
      status: 'normal',
      purchase_date: null,
      notes: String(raw.notes || '').trim(),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    db.parts.push(part);
    assignPart(part);
    result.registered++;
  });

  db.sync_reports = db.sync_reports.filter((r) => r.id !== report.id);
  logAction(db, req, {
    action: 'sync.apply',
    target_type: 'server',
    target_id: server.id,
    target_name: server.name,
    detail: `取り外し${result.removed}件 / 割り当て${result.assigned}件 / 新規登録${result.registered}件`,
  });
  writeDB(db);
  res.json(result);
});

router.delete('/reports/:id', (req, res) => {
  const db = readDB();
  const report = db.sync_reports.find((r) => r.id === Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'レポートが見つかりません' });
  db.sync_reports = db.sync_reports.filter((r) => r.id !== report.id);
  logAction(db, req, {
    action: 'sync.dismiss',
    target_type: 'server',
    target_id: report.server_id,
    target_name: report.server_name,
    detail: '差分を破棄',
  });
  writeDB(db);
  res.status(204).end();
});

module.exports = router;
