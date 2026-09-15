const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../db');
const { logAction, activeServers, findActiveServer } = require('../audit');
const { requireAdmin } = require('../auth');
const { encrypt, decrypt } = require('../secret-store');
const { collectOverSsh, csvToParts } = require('../ssh-collect');
const { computeDiff, storeReport, summarizeDiff } = require('../sync-core');

function decorate(db, server) {
  const active = db.assignments.filter((a) => a.server_id === server.id && a.removed_at === null);
  const { ssh, ...rest } = server;
  return {
    ...rest,
    current_parts_count: active.length,
    // 秘密情報(password/private_key/passphrase)は絶対に返さない。設定済みかどうかだけ伝える。
    ssh: ssh ? {
      configured: true,
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      auth_method: ssh.auth_method,
      os_hint: ssh.os_hint,
      use_sudo: !!ssh.use_sudo,
    } : { configured: false },
  };
}

router.get('/', (req, res) => {
  const db = readDB();
  let servers = activeServers(db).map((s) => decorate(db, s));
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
  const server = findActiveServer(db, req.params.id);
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
    deleted_at: null,
  };
  db.servers.push(server);
  logAction(db, req, { action: 'server.create', target_type: 'server', target_id: server.id, target_name: server.name });
  writeDB(db);
  res.status(201).json(decorate(db, server));
});

router.put('/:id', (req, res) => {
  const db = readDB();
  const server = findActiveServer(db, req.params.id);
  if (!server) return res.status(404).json({ error: 'サーバーが見つかりません' });
  const { name, location, status, notes } = req.body || {};
  if (name !== undefined) server.name = String(name).trim();
  if (location !== undefined) server.location = String(location).trim();
  if (status !== undefined) server.status = String(status).trim();
  if (notes !== undefined) server.notes = String(notes).trim();
  server.updated_at = new Date().toISOString();
  logAction(db, req, { action: 'server.update', target_type: 'server', target_id: server.id, target_name: server.name });
  writeDB(db);
  res.json(decorate(db, server));
});

// 物理削除ではなくゴミ箱へ移動する
router.delete('/:id', (req, res) => {
  const db = readDB();
  const server = findActiveServer(db, req.params.id);
  if (!server) return res.status(404).json({ error: 'サーバーが見つかりません' });
  const hasActive = db.assignments.some((a) => a.server_id === server.id && a.removed_at === null);
  if (hasActive) {
    return res.status(400).json({ error: 'このサーバーにはパーツが割り当てられています。先にすべて取り外してください。' });
  }
  server.deleted_at = new Date().toISOString();
  logAction(db, req, { action: 'server.delete', target_type: 'server', target_id: server.id, target_name: server.name });
  writeDB(db);
  res.status(204).end();
});

/* ---- SSHによる遠隔取得（高度な設定）---- 認証情報を扱うため管理者専用 ---- */

// SSH接続情報を保存する。password/private_key を空欄で送ると「変更しない」扱いになる
// （毎回入力し直させないため）。値を消したい場合は DELETE /:id/ssh を使う。
router.put('/:id/ssh', requireAdmin, (req, res) => {
  const db = readDB();
  const server = findActiveServer(db, req.params.id);
  if (!server) return res.status(404).json({ error: 'サーバーが見つかりません' });

  const { host, port, username, auth_method, password, private_key, passphrase, os_hint, use_sudo } = req.body || {};
  if (!host || !String(host).trim()) return res.status(400).json({ error: 'ホストは必須です' });
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'ユーザー名は必須です' });
  const method = auth_method === 'key' ? 'key' : 'password';
  if (method === 'password' && !password && !(server.ssh && server.ssh.password_enc)) {
    return res.status(400).json({ error: 'パスワードを入力してください' });
  }
  if (method === 'key' && !private_key && !(server.ssh && server.ssh.private_key_enc)) {
    return res.status(400).json({ error: '秘密鍵を入力してください' });
  }

  const prev = server.ssh || {};
  server.ssh = {
    host: String(host).trim(),
    port: port ? Number(port) : 22,
    username: String(username).trim(),
    auth_method: method,
    password_enc: method === 'password'
      ? (password ? encrypt(String(password)) : prev.password_enc)
      : undefined,
    private_key_enc: method === 'key'
      ? (private_key ? encrypt(String(private_key)) : prev.private_key_enc)
      : undefined,
    passphrase_enc: method === 'key' && passphrase ? encrypt(String(passphrase)) : (method === 'key' ? prev.passphrase_enc : undefined),
    os_hint: os_hint === 'windows' ? 'windows' : 'linux',
    use_sudo: use_sudo !== false,
  };
  server.updated_at = new Date().toISOString();
  logAction(db, req, { action: 'server.ssh_configure', target_type: 'server', target_id: server.id, target_name: server.name });
  writeDB(db);
  res.json(decorate(db, server));
});

router.delete('/:id/ssh', requireAdmin, (req, res) => {
  const db = readDB();
  const server = findActiveServer(db, req.params.id);
  if (!server) return res.status(404).json({ error: 'サーバーが見つかりません' });
  delete server.ssh;
  server.updated_at = new Date().toISOString();
  logAction(db, req, { action: 'server.ssh_clear', target_type: 'server', target_id: server.id, target_name: server.name });
  writeDB(db);
  res.status(204).end();
});

// SSHで接続してその場で検出スクリプトを実行し、結果を構成同期の差分として保存する。
router.post('/:id/ssh-fetch', requireAdmin, async (req, res) => {
  const db = readDB();
  const server = findActiveServer(db, req.params.id);
  if (!server) return res.status(404).json({ error: 'サーバーが見つかりません' });
  if (!server.ssh) return res.status(400).json({ error: 'SSH接続情報が登録されていません。「高度な設定」から登録してください。' });

  let sshConfig;
  try {
    sshConfig = {
      host: server.ssh.host,
      port: server.ssh.port,
      username: server.ssh.username,
      auth_method: server.ssh.auth_method,
      password: server.ssh.password_enc ? decrypt(server.ssh.password_enc) : undefined,
      private_key: server.ssh.private_key_enc ? decrypt(server.ssh.private_key_enc) : undefined,
      passphrase: server.ssh.passphrase_enc ? decrypt(server.ssh.passphrase_enc) : undefined,
      os_hint: server.ssh.os_hint,
      use_sudo: server.ssh.use_sudo,
    };
  } catch {
    return res.status(500).json({ error: '保存された認証情報を復号できませんでした。SSH設定を登録し直してください。' });
  }

  let collected;
  try {
    collected = await collectOverSsh(sshConfig);
  } catch (err) {
    logAction(db, req, {
      action: 'server.ssh_fetch_failed',
      target_type: 'server',
      target_id: server.id,
      target_name: server.name,
      detail: err.message,
    });
    writeDB(db);
    return res.status(502).json({ error: `SSH取得に失敗しました: ${err.message}` });
  }

  const parts = csvToParts(collected.csvText);
  if (!parts.length) {
    logAction(db, req, {
      action: 'server.ssh_fetch_empty',
      target_type: 'server',
      target_id: server.id,
      target_name: server.name,
      detail: '検出結果が0件でした',
    });
    writeDB(db);
    return res.status(502).json({
      error: '実行はできましたが、パーツが検出できませんでした。権限（sudo/管理者）を確認してください。',
      detail: collected.stderrText.slice(0, 2000),
    });
  }

  const hostInfoLine = (collected.stderrText.split('\n').find((l) => l.includes('ホスト情報')) || '').replace(/^#\s*ホスト情報:\s*/, '').trim();
  const report = storeReport(db, req, { server, host_info: hostInfoLine, parts, source: 'SSH取得' });
  writeDB(db);

  const diff = computeDiff(db, report);
  res.json({ report_id: report.id, server: server.name, summary: summarizeDiff(diff) });
});

module.exports = router;
