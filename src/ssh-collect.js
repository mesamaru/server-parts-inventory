// SSH経由で対象サーバーに検出スクリプトを送り込み、実行結果(CSV)を受け取る。
// 対象がインターネットに出られない閉じた環境でも動くよう、スクリプトはSFTPでその場に
// 転送し、実行後に削除する（GitHubから取得させたりはしない）。
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const EXEC_TIMEOUT_MS = 60000;
const LINUX_SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'hw_to_csv.py'), 'utf-8');
const WINDOWS_SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'hw_to_csv.ps1'), 'utf-8');

function execWithTimeout(conn, cmd) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`コマンドの実行がタイムアウトしました（${EXEC_TIMEOUT_MS / 1000}秒）: ${cmd.slice(0, 60)}`));
    }, EXEC_TIMEOUT_MS);

    conn.exec(cmd, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(err); }
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (d) => { stdout += d.toString('utf8'); });
      stream.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
      stream.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ stdout, stderr, code });
      });
      stream.on('error', (streamErr) => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(streamErr); }
      });
    });
  });
}

function uploadFile(conn, remotePath, content) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(new Error(`SFTP接続に失敗しました: ${err.message}`));
      const stream = sftp.createWriteStream(remotePath);
      stream.on('close', resolve);
      stream.on('error', (writeErr) => reject(new Error(`スクリプトの転送に失敗しました: ${writeErr.message}`)));
      stream.end(content, 'utf8');
    });
  });
}

function connect(sshConfig) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const options = {
      host: sshConfig.host,
      port: sshConfig.port || 22,
      username: sshConfig.username,
      readyTimeout: 15000,
    };
    if (sshConfig.auth_method === 'key') {
      options.privateKey = sshConfig.private_key;
      if (sshConfig.passphrase) options.passphrase = sshConfig.passphrase;
    } else {
      options.password = sshConfig.password;
    }
    conn.on('ready', () => resolve(conn));
    conn.on('error', (err) => reject(new Error(`接続に失敗しました: ${err.message}`)));
    conn.connect(options);
  });
}

// sshConfig: { host, port, username, auth_method, password|private_key, passphrase, os_hint, use_sudo }
// 戻り値: { csvText, stderrText }
async function collectOverSsh(sshConfig) {
  const conn = await connect(sshConfig);
  try {
    if (sshConfig.os_hint === 'windows') {
      const tempDirResult = await execWithTimeout(conn, 'powershell -NoProfile -NonInteractive -Command "[System.IO.Path]::GetTempPath()"');
      const tempDir = tempDirResult.stdout.trim().replace(/[\\/]+$/, '');
      if (!tempDir) throw new Error('一時ディレクトリを取得できませんでした（PowerShellが使えるか確認してください）');
      const remotePath = `${tempDir}\\dmidex_${Date.now()}.ps1`;
      await uploadFile(conn, remotePath, WINDOWS_SCRIPT);
      try {
        const result = await execWithTimeout(
          conn,
          `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${remotePath}"`
        );
        return { csvText: result.stdout, stderrText: result.stderr };
      } finally {
        await execWithTimeout(conn, `powershell -NoProfile -NonInteractive -Command "Remove-Item -Force -ErrorAction SilentlyContinue '${remotePath}'"`).catch(() => {});
      }
    }

    const remotePath = `/tmp/dmidex_${Date.now()}.py`;
    await uploadFile(conn, remotePath, LINUX_SCRIPT);
    try {
      // sudoにパスワードを要求された場合はハングさせず即エラーにする(-n)
      const cmd = `${sshConfig.use_sudo ? 'sudo -n ' : ''}python3 ${remotePath}`;
      const result = await execWithTimeout(conn, cmd);
      if (result.code !== 0 && !result.stdout.trim()) {
        throw new Error(result.stderr.trim() || `リモートでの実行に失敗しました（終了コード ${result.code}）`);
      }
      return { csvText: result.stdout, stderrText: result.stderr };
    } finally {
      await execWithTimeout(conn, `rm -f ${remotePath}`).catch(() => {});
    }
  } finally {
    conn.end();
  }
}

// スクリプトが出力するCSV（RFC4180風、"..."でクォート）を最小限だけ解釈するパーサー。
// ブラウザ側 app.js の parseCSV と同じ考え方。
function parseCsv(text) {
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // \r\n の \n 側で改行処理する
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// CSVテキストを { category, name, maker, spec, serial_number, notes } の配列に変換する
function csvToParts(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (key) => header.indexOf(key);
  const iCategory = idx('category');
  const iName = idx('name');
  const iMaker = idx('maker');
  const iSpec = idx('spec');
  const iSerial = idx('serial_number');
  const iNotes = idx('notes');
  if (iCategory === -1 || iName === -1) return [];

  return rows.slice(1).map((cols) => ({
    category: (cols[iCategory] || '').trim(),
    name: (cols[iName] || '').trim(),
    maker: iMaker !== -1 ? (cols[iMaker] || '').trim() : '',
    spec: iSpec !== -1 ? (cols[iSpec] || '').trim() : '',
    serial_number: iSerial !== -1 ? (cols[iSerial] || '').trim() : '',
    notes: iNotes !== -1 ? (cols[iNotes] || '').trim() : '',
  })).filter((p) => p.category && p.name);
}

module.exports = { collectOverSsh, csvToParts };
