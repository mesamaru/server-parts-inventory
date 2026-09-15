const crypto = require('crypto');
const { readDB } = require('./db');

const SESSION_DAYS = 30;
const SESSION_COOKIE = 'sid';

// パスワードはNode標準のscryptでハッシュ化する（外部パッケージ不要）
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const actual = Buffer.from(hash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  // Secure属性は付けない（PterodactylではHTTPで公開されることが多いため）
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// 有効なセッションを1件作り、ついでに期限切れのセッションを掃除する
function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.sessions = db.sessions.filter((s) => new Date(s.expires_at).getTime() > now);
  db.sessions.push({
    token,
    user_id: userId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_DAYS * 86400000).toISOString(),
  });
  return token;
}

function sessionUser(db, req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = db.sessions.find((s) => s.token === token);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) return null;
  return db.users.find((u) => u.id === session.user_id) || null;
}

// Proxmoxホストからの構成送信など、ブラウザ以外からのアクセス用
function apiTokenUser(db, req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = db.api_tokens.find((t) => t.token_hash === hashToken(header.slice(7).trim()));
  if (!token) return null;
  return { id: null, username: `token:${token.name}`, role: 'api' };
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role };
}

function requireAuth(req, res, next) {
  const db = readDB();
  const user = sessionUser(db, req) || apiTokenUser(db, req);
  if (!user) return res.status(401).json({ error: '認証が必要です' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '管理者権限が必要です' });
  }
  next();
}

module.exports = {
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
};
