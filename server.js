const express = require('express');
const path = require('path');

const partsRouter = require('./src/routes/parts');
const serversRouter = require('./src/routes/servers');
const assignmentsRouter = require('./src/routes/assignments');
const authRouter = require('./src/routes/auth');
const trashRouter = require('./src/routes/trash');
const auditRouter = require('./src/routes/audit');
const syncRouter = require('./src/routes/sync');
const dashboardRouter = require('./src/routes/dashboard');
const { requireAuth } = require('./src/auth');

const app = express();

// Pterodactyl の Node.js Generic Egg は環境変数 SERVER_PORT でポートを渡すことが多いが、
// 素の PORT や未設定時の既定値にもフォールバックする。
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

// 写真はbase64でJSONに載せて送るため既定の100kbでは足りない
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRouter);
// データを扱うAPIはすべてログイン（またはAPIトークン）必須
app.use('/api/parts', requireAuth, partsRouter);
app.use('/api/servers', requireAuth, serversRouter);
app.use('/api/assignments', requireAuth, assignmentsRouter);
app.use('/api/trash', requireAuth, trashRouter);
app.use('/api/audit', requireAuth, auditRouter);
app.use('/api/sync', requireAuth, syncRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'サーバー内部エラーが発生しました' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`server-parts-inventory listening on 0.0.0.0:${PORT}`);
});
