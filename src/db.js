const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

function emptyDB() {
  return {
    parts: [],
    servers: [],
    assignments: [],
    seq: { parts: 0, servers: 0, assignments: 0 },
  };
}

function ensureDB() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyDB(), null, 2), 'utf-8');
  }
}

function readDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  const db = JSON.parse(raw);
  if (!db.seq) db.seq = { parts: 0, servers: 0, assignments: 0 };
  return db;
}

function writeDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_FILE);
}

function nextId(db, table) {
  db.seq[table] = (db.seq[table] || 0) + 1;
  return db.seq[table];
}

module.exports = { readDB, writeDB, nextId };
