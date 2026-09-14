const express = require('express');
const path = require('path');

const partsRouter = require('./src/routes/parts');
const serversRouter = require('./src/routes/servers');
const assignmentsRouter = require('./src/routes/assignments');

const app = express();

// Pterodactyl の Node.js Generic Egg は環境変数 SERVER_PORT でポートを渡すことが多いが、
// 素の PORT や未設定時の既定値にもフォールバックする。
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/parts', partsRouter);
app.use('/api/servers', serversRouter);
app.use('/api/assignments', assignmentsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'サーバー内部エラーが発生しました' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`server-parts-inventory listening on 0.0.0.0:${PORT}`);
});
