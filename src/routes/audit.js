const express = require('express');
const router = express.Router();
const { readDB } = require('../db');

router.get('/', (req, res) => {
  const db = readDB();
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = [...db.audit_logs].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
  res.json(logs);
});

module.exports = router;
