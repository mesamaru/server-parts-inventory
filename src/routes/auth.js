const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../db');
const {
  SESSION_COOKIE,
  parseCookies,
  hashPassword,
  verifyPassword,
  hashToken,
  setSessionCookie,
  clearSessionCookie,
  createSession,
  sessionUser,
  publicUser,
  requireAuth,
  requireAdmin,
} = require('../auth');

const MIN_PASSWORD_LENGTH = 8;

function validateCredentials(username, password) {
  if (!username || !String(username).trim()) return 'ユーザー名は必須です';
  if (!/^[\w.@-]{1,32}$/.test(String(username).trim())) {
    return 'ユーザー名は32文字以内の英数字・記号(. _ - @)で入力してください';
  }
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    return `パスワードは${MIN_PASSWORD_LENGTH}文字以上で設定してください`;
  }
  return '';
}

// 初期設定が必要かどうかと、ログイン中のユーザーを返す（認証不要）
router.get('/state', (req, res) => {
  const db = readDB();
  const user = sessionUser(db, req);
  res.json({
    setup_required: db.users.length === 0,
    user: user ? publicUser(user) : null,
  });
});

// 最初の管理者アカウントを作る。ユーザーが1人でも居れば使えない。
router.post('/setup', (req, res) => {
  const db = readDB();
  if (db.users.length) return res.status(400).json({ error: '既に初期設定が完了しています' });
  const { username, password } = req.body || {};
  const error = validateCredentials(username, password);
  if (error) return res.status(400).json({ error });

  const { salt, hash } = hashPassword(String(password));
  const user = {
    id: nextId(db, 'users'),
    username: String(username).trim(),
    salt,
    password_hash: hash,
    role: 'admin',
    created_at: new Date().toISOString(),
  };
  db.users.push(user);
  const token = createSession(db, user.id);
  writeDB(db);
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const db = readDB();
  const { username, password } = req.body || {};
  const user = db.users.find((u) => u.username === String(username || '').trim());
  if (!user || !verifyPassword(String(password || ''), user.salt, user.password_hash)) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  }
  user.last_login_at = new Date().toISOString();
  const token = createSession(db, user.id);
  writeDB(db);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const db = readDB();
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token && db.sessions.some((s) => s.token === token)) {
    db.sessions = db.sessions.filter((s) => s.token !== token);
    writeDB(db);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

router.post('/password', requireAuth, (req, res) => {
  if (req.user.role === 'api') return res.status(403).json({ error: 'APIトークンでは変更できません' });
  const db = readDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  const { current_password, new_password } = req.body || {};
  if (!verifyPassword(String(current_password || ''), user.salt, user.password_hash)) {
    return res.status(400).json({ error: '現在のパスワードが違います' });
  }
  if (!new_password || String(new_password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上で設定してください` });
  }
  const { salt, hash } = hashPassword(String(new_password));
  user.salt = salt;
  user.password_hash = hash;
  user.updated_at = new Date().toISOString();
  // パスワード変更時は自分の他セッションを無効化する
  db.sessions = db.sessions.filter((s) => s.user_id !== user.id);
  const token = createSession(db, user.id);
  writeDB(db);
  setSessionCookie(res, token);
  res.json({ ok: true });
});

/* ---- ユーザー管理（管理者のみ） ---- */

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.users.map((u) => ({ ...publicUser(u), created_at: u.created_at, last_login_at: u.last_login_at || null })));
});

router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();
  const { username, password, role } = req.body || {};
  const error = validateCredentials(username, password);
  if (error) return res.status(400).json({ error });
  if (db.users.some((u) => u.username === String(username).trim())) {
    return res.status(400).json({ error: '同じユーザー名が既に存在します' });
  }
  const { salt, hash } = hashPassword(String(password));
  const user = {
    id: nextId(db, 'users'),
    username: String(username).trim(),
    salt,
    password_hash: hash,
    role: role === 'admin' ? 'admin' : 'member',
    created_at: new Date().toISOString(),
  };
  db.users.push(user);
  writeDB(db);
  res.status(201).json(publicUser(user));
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();
  const id = Number(req.params.id);
  const idx = db.users.findIndex((u) => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (id === req.user.id) return res.status(400).json({ error: '自分自身は削除できません' });
  const admins = db.users.filter((u) => u.role === 'admin');
  if (db.users[idx].role === 'admin' && admins.length <= 1) {
    return res.status(400).json({ error: '管理者が居なくなるため削除できません' });
  }
  db.users.splice(idx, 1);
  db.sessions = db.sessions.filter((s) => s.user_id !== id);
  writeDB(db);
  res.status(204).end();
});

/* ---- APIトークン（Proxmoxホストからの構成送信などに使う） ---- */

router.get('/tokens', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.api_tokens.map((t) => ({ id: t.id, name: t.name, created_at: t.created_at })));
});

router.post('/tokens', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'トークン名は必須です' });
  const raw = crypto.randomBytes(24).toString('hex');
  const token = {
    id: nextId(db, 'api_tokens'),
    name: String(name).trim(),
    token_hash: hashToken(raw),
    created_at: new Date().toISOString(),
  };
  db.api_tokens.push(token);
  writeDB(db);
  // 平文トークンを返すのはこの1回だけ
  res.status(201).json({ id: token.id, name: token.name, token: raw });
});

router.delete('/tokens/:id', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();
  const idx = db.api_tokens.findIndex((t) => t.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'トークンが見つかりません' });
  db.api_tokens.splice(idx, 1);
  writeDB(db);
  res.status(204).end();
});

module.exports = router;
