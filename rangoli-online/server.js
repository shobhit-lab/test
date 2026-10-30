'use strict';
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---------- Database ----------
const sql = new Database(path.join(DATA_DIR, 'rangoli.db'));
sql.pragma('journal_mode = WAL');
sql.pragma('foreign_keys = ON');
sql.exec(`
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  hash     TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token    TEXT PRIMARY KEY,               -- stored as SHA-256 of the real token
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  expires  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS store (          -- the whole app database as one JSON document
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  data    TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`);

const q = {
  userCount: sql.prepare('SELECT COUNT(*) AS n FROM users'),
  user: sql.prepare('SELECT username, hash, is_admin FROM users WHERE username = ?'),
  users: sql.prepare('SELECT username, is_admin FROM users ORDER BY username'),
  addUser: sql.prepare('INSERT INTO users (username, hash, is_admin) VALUES (?, ?, ?)'),
  delUser: sql.prepare('DELETE FROM users WHERE username = ?'),
  addSession: sql.prepare('INSERT INTO sessions (token, username, expires) VALUES (?, ?, ?)'),
  session: sql.prepare(`SELECT s.username, u.is_admin FROM sessions s
                        JOIN users u ON u.username = s.username
                        WHERE s.token = ? AND s.expires > ?`),
  delSession: sql.prepare('DELETE FROM sessions WHERE token = ?'),
  delUserSessions: sql.prepare('DELETE FROM sessions WHERE username = ?'),
  purgeSessions: sql.prepare('DELETE FROM sessions WHERE expires <= ?'),
  store: sql.prepare('SELECT data, version FROM store WHERE id = 1'),
  putStore: sql.prepare(`INSERT INTO store (id, data, version, updated) VALUES (1, ?, ?, ?)
                         ON CONFLICT(id) DO UPDATE SET data = excluded.data,
                         version = excluded.version, updated = excluded.updated`),
  getMeta: sql.prepare('SELECT v FROM meta WHERE k = ?'),
  putMeta: sql.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
};

// ---------- Helpers ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const USER_RE = /^[a-z0-9._@-]{2,60}$/;
const MIN_PASS = 6;
const SESSION_MS = 30 * 24 * 3600 * 1000;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps login timing equal for unknown users

function newSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  q.addSession.run(sha(token), username, Date.now() + SESSION_MS);
  return token;
}

// Login lockout: 5 wrong tries per (IP + username), or 15 per username, locks for 15 minutes.
const fails = new Map();
const locked = k => (fails.get(k)?.until || 0) > Date.now();
function noteFail(k, max) {
  const f = fails.get(k) || { n: 0, until: 0 };
  if (++f.n >= max) { f.until = Date.now() + 15 * 60 * 1000; f.n = 0; }
  fails.set(k, f);
}
setInterval(() => { for (const [k, f] of fails) if (f.until < Date.now() && !f.n) fails.delete(k); }, 600000).unref();

function auth(req, res, next) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '');
  const row = m && q.session.get(sha(m[1]), Date.now());
  if (!row) return res.status(401).json({ error: 'Please log in again' });
  req.user = row.username;
  req.admin = !!row.is_admin;
  req.tokenHash = sha(m[1]);
  next();
}
const adminOnly = (req, res, next) => req.admin ? next() : res.status(403).json({ error: 'Admin only' });

const validDb = d => d && typeof d === 'object' && ['prods', 'moves', 'cats', 'units'].every(k => Array.isArray(d[k]));

// ---------- App ----------
const app = express();
app.set('trust proxy', 1); // behind Caddy
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/status', (req, res) => res.json({ needsSetup: q.userCount.get().n === 0 }));

// First run only: create the admin account.
app.post('/api/setup', (req, res) => {
  if (q.userCount.get().n > 0) return res.status(403).json({ error: 'Already set up' });
  const u = String(req.body.u || '').trim().toLowerCase(), p = String(req.body.p || '');
  if (!USER_RE.test(u) || p.length < MIN_PASS) return res.status(400).json({ error: `Username 2+ characters, password ${MIN_PASS}+ characters` });
  q.addUser.run(u, bcrypt.hashSync(p, 10), 1);
  res.json({ token: newSession(u), user: u, admin: true });
});

app.post('/api/login', (req, res) => {
  const u = String(req.body.u || '').trim().toLowerCase(), p = String(req.body.p || '');
  const k1 = req.ip + '|' + u, k2 = 'u|' + u;
  if (locked(k1) || locked(k2)) return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
  const row = q.user.get(u);
  const ok = bcrypt.compareSync(p, row ? row.hash : DUMMY_HASH) && row;
  if (!ok) { noteFail(k1, 5); noteFail(k2, 15); return res.status(401).json({ error: 'Wrong username or password' }); }
  fails.delete(k1);
  q.purgeSessions.run(Date.now());
  res.json({ token: newSession(row.username), user: row.username, admin: !!row.is_admin });
});

app.post('/api/logout', auth, (req, res) => { q.delSession.run(req.tokenHash); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ user: req.user, admin: req.admin }));

// ----- Data: whole app database with optimistic version check -----
app.get('/api/db', auth, (req, res) => {
  const row = q.store.get();
  const version = row ? row.version : 0;
  if (row && +req.query.since === version) return res.json({ same: true, version });
  res.json({ db: row ? JSON.parse(row.data) : null, version });
});

const saveTx = sql.transaction((data, version) => {
  const cur = q.store.get();
  const curV = cur ? cur.version : 0;
  if (version !== curV) return { conflict: cur };
  q.putStore.run(JSON.stringify(data), curV + 1, new Date().toISOString());
  return { version: curV + 1 };
});

app.post('/api/db', auth, (req, res) => {
  const { db, version } = req.body || {};
  if (!validDb(db) || !Number.isInteger(version)) return res.status(400).json({ error: 'Invalid data' });
  const r = saveTx(db, version);
  if (r.conflict) return res.status(409).json({ error: 'conflict', db: JSON.parse(r.conflict.data), version: r.conflict.version });
  res.json({ version: r.version });
});

// ----- Users (admin only) -----
app.get('/api/users', auth, adminOnly, (req, res) =>
  res.json({ users: q.users.all().map(u => ({ username: u.username, admin: !!u.is_admin })) }));

app.post('/api/users', auth, adminOnly, (req, res) => {
  const u = String(req.body.u || '').trim().toLowerCase(), p = String(req.body.p || '');
  if (!USER_RE.test(u) || p.length < MIN_PASS) return res.status(400).json({ error: `Username 2+ characters, password ${MIN_PASS}+ characters` });
  if (q.user.get(u)) return res.status(409).json({ error: 'That username already exists' });
  q.addUser.run(u, bcrypt.hashSync(p, 10), 0);
  res.json({ ok: true });
});

app.delete('/api/users/:u', auth, adminOnly, (req, res) => {
  const u = String(req.params.u).toLowerCase();
  const row = q.user.get(u);
  if (!row) return res.status(404).json({ error: 'No such user' });
  if (row.is_admin) return res.status(400).json({ error: 'The admin cannot be deleted' });
  q.delUserSessions.run(u);
  q.delUser.run(u);
  res.json({ ok: true });
});

// ----- Static files -----
const PUB = path.join(__dirname, 'public');
const noStore = (req, res) => res.set('Cache-Control', 'no-store');
app.get(['/', '/index.html'], (req, res) => { noStore(req, res); res.sendFile(path.join(PUB, 'index.html')); });
app.get('/sw.js', (req, res) => { noStore(req, res); res.sendFile(path.join(PUB, 'sw.js')); });
app.use(express.static(PUB, { index: false }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: 'Bad request' }));

// ---------- Scheduled jobs: low-stock alerts (5 PM, 1 AM) and nightly backup (2 AM) ----------
const pad = n => String(n).padStart(2, '0');
function once(name, key, fn) {
  const row = q.getMeta.get('done:' + name);
  if (row && row.v === key) return;
  q.putMeta.run('done:' + name, key);
  Promise.resolve().then(fn).catch(e => console.error(name, 'failed:', e.message));
}

async function sendLowStock() {
  const row = q.store.get();
  if (!row) return;
  const low = JSON.parse(row.data).prods.filter(p => !p.arch && p.stock <= p.min);
  if (!low.length) return;
  const text = ('Low stock: ' + low.map(p => `${p.name} ${p.stock} ${p.unit}`).join(', ')).slice(0, 4000);
  console.log(text);
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const jobs = [];
  const { TELEGRAM_BOT_TOKEN: tk, TELEGRAM_CHAT_ID: chat, NOTIFY_WEBHOOK: hook } = process.env;
  if (tk && chat) jobs.push(post(`https://api.telegram.org/bot${tk}/sendMessage`, { chat_id: chat, text: 'Rangoli ERP\n' + text }));
  if (hook) jobs.push(post(hook, { text, items: low.map(p => ({ name: p.name, stock: p.stock, unit: p.unit, min: p.min })) }));
  await Promise.allSettled(jobs);
}

async function nightlyBackup() {
  const n = new Date();
  await sql.backup(path.join(BACKUP_DIR, `rangoli-${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}.db`));
  const files = fs.readdirSync(BACKUP_DIR).filter(f => /^rangoli-.*\.db$/.test(f)).sort();
  files.slice(0, Math.max(0, files.length - 14)).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
}

setInterval(() => {
  const n = new Date(), day = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
  const h = n.getHours(), m = n.getMinutes();
  if (m === 0 && (h === 17 || h === 1)) once('alert', day + ' ' + h, sendLowStock);
  if (h === 2 && m < 10) once('backup', day, nightlyBackup);
}, 30000).unref();

app.listen(PORT, () => console.log(`Rangoli ERP running on port ${PORT} (timezone ${process.env.TZ})`));
