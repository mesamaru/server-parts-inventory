const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../db');
const { logAction, activeParts, activeServers, findActiveServer } = require('../audit');
const { computeDiff, storeReport, summarizeDiff } = require('../sync-core');

// Proxmoxホスト等からの構成送信。APIトークンでもセッションでも受け付ける。
// server_name は「分かれば自動で割り当てる」ための任意ヒント。一致しない/未指定でもエラーにはせず、
// 「未割り当て」として受け付ける（Web側の構成同期タブでサーバーを選んで割り当てる）。
router.post('/report', (req, res) => {
  const db = readDB();
  const { server_name, hostname, host_info, parts } = req.body || {};
  if (!Array.isArray(parts)) {
    return res.status(400).json({ error: 'parts は配列で送ってください' });
  }

  // 一致判定には server_name（明示的な指定）だけを使う。表示用のホスト名は
  // 実機の hostname を優先し、無ければ server_name にフォールバックする。
  const matchHint = String(server_name || '').trim();
  const displayHint = String(hostname || server_name || '').trim();
  const server = matchHint ? activeServers(db).find((s) => s.name === matchHint) || null : null;

  const report = storeReport(db, req, {
    server,
    hostname: displayHint,
    host_info,
    parts,
    source: server ? 'スクリプト送信' : 'スクリプト送信（サーバー未指定）',
  });
  writeDB(db);

  if (!server) {
    return res.status(201).json({
      report_id: report.id,
      needs_server: true,
      parts_count: report.parts.length,
    });
  }
  const diff = computeDiff(db, report);
  res.status(201).json({
    report_id: report.id,
    server: server.name,
    summary: summarizeDiff(diff),
  });
});

router.get('/reports', (req, res) => {
  const db = readDB();
  res.json(db.sync_reports
    .filter((r) => r.server_id === null || findActiveServer(db, r.server_id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((r) => (r.server_id === null
      ? {
        id: r.id,
        server_id: null,
        needs_server: true,
        hostname: r.hostname,
        host_info: r.host_info,
        created_at: r.created_at,
        parts: r.parts,
      }
      : {
        id: r.id,
        server_id: r.server_id,
        server_name: r.server_name,
        host_info: r.host_info,
        created_at: r.created_at,
        diff: computeDiff(db, r),
      })));
});

// 未割り当てのレポートに対象サーバーを割り当てる。part_indices を指定すると、
// 受信したパーツのうち選んだものだけを残して以降の差分計算に使う（一括選択）。
router.post('/reports/:id/assign-server', (req, res) => {
  const db = readDB();
  const report = db.sync_reports.find((r) => r.id === Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'レポートが見つかりません' });
  if (report.server_id !== null) return res.status(400).json({ error: 'このレポートは既にサーバーへ割り当て済みです' });

  const { server_id, part_indices } = req.body || {};
  const server = findActiveServer(db, server_id);
  if (!server) return res.status(400).json({ error: 'サーバーが見つかりません' });

  if (Array.isArray(part_indices)) {
    const keep = new Set(part_indices.map(Number));
    report.parts = report.parts.filter((_, i) => keep.has(i));
  }
  if (!report.parts.length) {
    return res.status(400).json({ error: '割り当てるパーツが1件もありません（すべて除外されています）' });
  }

  report.server_id = server.id;
  report.server_name = server.name;
  db.sync_reports = db.sync_reports.filter((r) => r.id === report.id || r.server_id !== server.id);
  logAction(db, req, {
    action: 'sync.assign_server',
    target_type: 'server',
    target_id: server.id,
    target_name: server.name,
    detail: `未割り当てレポート（${report.hostname || '不明なホスト'}）を割り当て`,
  });
  writeDB(db);

  const diff = computeDiff(db, report);
  res.json({
    id: report.id,
    server_id: report.server_id,
    server_name: report.server_name,
    host_info: report.host_info,
    created_at: report.created_at,
    diff,
  });
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
    target_name: report.server_name || report.hostname || '(未割り当て)',
    detail: '差分を破棄',
  });
  writeDB(db);
  res.status(204).end();
});

module.exports = router;
