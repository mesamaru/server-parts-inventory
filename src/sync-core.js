const { nextId } = require('./db');
const { logAction, activeParts } = require('./audit');

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

function normalizeParts(parts) {
  return (parts || [])
    .map((p) => ({
      category: String(p.category || '').trim(),
      name: String(p.name || '').trim(),
      maker: String(p.maker || '').trim(),
      spec: String(p.spec || '').trim(),
      serial_number: String(p.serial_number || '').trim(),
      notes: String(p.notes || '').trim(),
    }))
    .filter((p) => p.category && p.name);
}

// レポートを作って保存する（差分計算はしない。呼び出し側が必要ならcomputeDiffを呼ぶ）。
// 同じサーバーの未処理レポートは最新のものだけ残す。db.writeDB は呼び出し側の責任。
function storeReport(db, req, { server, host_info, parts, source }) {
  const normalized = normalizeParts(parts);
  const report = {
    id: nextId(db, 'sync_reports'),
    server_id: server.id,
    server_name: server.name,
    host_info: String(host_info || '').trim(),
    created_at: new Date().toISOString(),
    parts: normalized,
  };
  db.sync_reports = db.sync_reports.filter((r) => r.server_id !== server.id);
  db.sync_reports.push(report);
  logAction(db, req, {
    action: 'sync.report',
    target_type: 'server',
    target_id: server.id,
    target_name: server.name,
    detail: `${normalized.length}件の構成を受信（${source || '手動送信'}）`,
  });
  return report;
}

function summarizeDiff(diff) {
  return {
    matched: diff.matched.length,
    to_assign: diff.to_assign.length,
    unregistered: diff.unregistered.length,
    to_remove: diff.to_remove.length,
  };
}

module.exports = { computeDiff, storeReport, normalizeParts, summarizeDiff };
