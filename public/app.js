/* eslint-disable no-alert */
const STATUS_LABEL = { normal: '正常', broken: '故障', retired: '廃棄' };
const STATE_LABEL = { in_stock: '在庫', assigned: '使用中' };

let partsCache = [];
let serversCache = [];

/* ---------- api helper ---------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!res.ok) {
    const msg = (body && body.error) || `リクエストに失敗しました (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- tabs ---------- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

/* ================= パーツ一覧 ================= */

async function loadParts() {
  const params = new URLSearchParams();
  const q = document.getElementById('parts-search').value.trim();
  const category = document.getElementById('parts-filter-category').value;
  const state = document.getElementById('parts-filter-state').value;
  const status = document.getElementById('parts-filter-status').value;
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (state) params.set('assignment_state', state);
  if (status) params.set('status', status);
  partsCache = await api(`/api/parts?${params.toString()}`);
  renderCategoryFilterOptions();
  renderPartsTable();
}

function renderCategoryFilterOptions() {
  const sel = document.getElementById('parts-filter-category');
  const current = sel.value;
  const categories = [...new Set(partsCache.map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'ja'));
  sel.innerHTML = '<option value="">すべてのカテゴリ</option>' +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = current;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderPartsTable() {
  const tbody = document.getElementById('parts-tbody');
  const empty = document.getElementById('parts-empty');
  if (!partsCache.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  tbody.innerHTML = partsCache.map((p) => {
    const stateBadge = p.assignment_state
      ? `<span class="badge state-${p.assignment_state}">${STATE_LABEL[p.assignment_state]}</span>`
      : '-';
    const serverCell = p.current_server_id
      ? `<button class="server-link" data-open-server="${p.current_server_id}">${escapeHtml(p.current_server_name || '')}</button>`
      : '-';
    const actions = [];
    if (p.status === 'normal' && p.assignment_state === 'in_stock') {
      actions.push(`<button class="link" data-assign-part="${p.id}">割り当てる</button>`);
    }
    if (p.assignment_state === 'assigned') {
      actions.push(`<button class="link" data-remove-assignment="${p.current_assignment_id}">取り外す</button>`);
      actions.push(`<button class="link" data-move-assignment="${p.current_assignment_id}" data-move-part="${escapeHtml(p.name)}">移動</button>`);
    }
    actions.push(`<button class="link" data-part-history="${p.id}">履歴</button>`);
    actions.push(`<button class="link" data-edit-part="${p.id}">編集</button>`);
    actions.push(`<button class="link" data-delete-part="${p.id}">削除</button>`);
    return `<tr>
      <td data-label="カテゴリ">${escapeHtml(p.category)}</td>
      <td data-label="名称">${escapeHtml(p.name)}</td>
      <td data-label="スペック">${escapeHtml(p.spec) || '-'}</td>
      <td data-label="シリアル番号">${escapeHtml(p.serial_number) || '-'}</td>
      <td data-label="ステータス"><span class="badge status-${p.status}">${STATUS_LABEL[p.status]}</span></td>
      <td data-label="状態">${stateBadge}</td>
      <td data-label="割当先">${serverCell}</td>
      <td data-label="操作"><div class="row-actions">${actions.join('')}</div></td>
    </tr>`;
  }).join('');
}

document.getElementById('parts-search').addEventListener('input', debounce(loadParts, 250));
document.getElementById('parts-filter-category').addEventListener('change', loadParts);
document.getElementById('parts-filter-state').addEventListener('change', loadParts);
document.getElementById('parts-filter-status').addEventListener('change', loadParts);

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.getElementById('parts-tbody').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.openServer) return openServerDetail(Number(t.dataset.openServer));
  if (t.dataset.assignPart) return openAssignDialog({ partId: Number(t.dataset.assignPart) });
  if (t.dataset.removeAssignment) return removeAssignment(Number(t.dataset.removeAssignment));
  if (t.dataset.moveAssignment) return openMoveDialog(Number(t.dataset.moveAssignment), t.dataset.movePart);
  if (t.dataset.partHistory) return openPartHistory(Number(t.dataset.partHistory));
  if (t.dataset.editPart) return openPartDialog(Number(t.dataset.editPart));
  if (t.dataset.deletePart) return deletePart(Number(t.dataset.deletePart));
});

async function removeAssignment(assignmentId) {
  if (!confirm('このパーツを取り外して在庫に戻しますか？')) return;
  try {
    await api(`/api/assignments/${assignmentId}/remove`, { method: 'POST', body: JSON.stringify({}) });
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
}

async function deletePart(id) {
  if (!confirm('このパーツを削除します。よろしいですか？')) return;
  try {
    await api(`/api/parts/${id}`, { method: 'DELETE' });
    await loadParts();
  } catch (err) {
    alert(err.message);
  }
}

/* ---- パーツ登録/編集ダイアログ ---- */
const dlgPart = document.getElementById('dlg-part');
document.getElementById('btn-new-part').addEventListener('click', () => openPartDialog(null));
document.getElementById('btn-part-cancel').addEventListener('click', () => dlgPart.close());

function openPartDialog(id) {
  document.getElementById('part-err').hidden = true;
  document.getElementById('form-part').reset();
  document.getElementById('part-id').value = id || '';
  document.getElementById('part-status').value = 'normal';
  if (id) {
    const p = partsCache.find((x) => x.id === id);
    document.getElementById('part-dlg-title').textContent = 'パーツを編集';
    document.getElementById('part-category').value = p.category;
    document.getElementById('part-name').value = p.name;
    document.getElementById('part-spec').value = p.spec;
    document.getElementById('part-serial').value = p.serial_number;
    document.getElementById('part-status').value = p.status;
    document.getElementById('part-purchase-date').value = p.purchase_date ? p.purchase_date.slice(0, 10) : '';
    document.getElementById('part-notes').value = p.notes;
  } else {
    document.getElementById('part-dlg-title').textContent = '新規パーツ登録';
  }
  dlgPart.showModal();
}

document.getElementById('form-part').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('part-id').value;
  const payload = {
    category: document.getElementById('part-category').value.trim(),
    name: document.getElementById('part-name').value.trim(),
    spec: document.getElementById('part-spec').value.trim(),
    serial_number: document.getElementById('part-serial').value.trim(),
    status: document.getElementById('part-status').value,
    purchase_date: document.getElementById('part-purchase-date').value || null,
    notes: document.getElementById('part-notes').value.trim(),
  };
  try {
    if (id) {
      await api(`/api/parts/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/parts', { method: 'POST', body: JSON.stringify(payload) });
    }
    dlgPart.close();
    await loadParts();
  } catch (err) {
    const el = document.getElementById('part-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

/* ---- CSV一括登録ダイアログ ---- */
const dlgBulkImport = document.getElementById('dlg-bulk-import');
const HEADER_ALIASES = {
  category: ['category', 'カテゴリ'],
  name: ['name', '名称', '型番', '品名'],
  spec: ['spec', 'スペック', '仕様'],
  serial_number: ['serial_number', 'serial', 'シリアル番号', 'シリアル'],
  status: ['status', 'ステータス', '状態'],
  purchase_date: ['purchase_date', '購入日'],
  notes: ['notes', '備考', 'メモ'],
};
let bulkParsedRows = [];

document.getElementById('btn-bulk-import').addEventListener('click', () => {
  document.getElementById('bulk-csv-text').value = '';
  document.getElementById('bulk-file-input').value = '';
  document.getElementById('bulk-preview-wrap').hidden = true;
  document.getElementById('bulk-err').hidden = true;
  document.getElementById('bulk-result').hidden = true;
  document.getElementById('btn-bulk-submit').disabled = true;
  bulkParsedRows = [];
  dlgBulkImport.showModal();
});
document.getElementById('btn-bulk-cancel').addEventListener('click', () => dlgBulkImport.close());

document.getElementById('bulk-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { document.getElementById('bulk-csv-text').value = String(reader.result); };
  reader.readAsText(file, 'utf-8');
});

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
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
      // skip, \r\n の \n 側で改行処理する
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function mapHeader(headerRow) {
  const map = {};
  headerRow.forEach((raw, i) => {
    const h = raw.trim();
    const hLower = h.toLowerCase();
    const field = Object.keys(HEADER_ALIASES).find((key) =>
      HEADER_ALIASES[key].some((alias) => alias.toLowerCase() === hLower || alias === h)
    );
    if (field) map[field] = i;
  });
  return map;
}

document.getElementById('btn-bulk-preview').addEventListener('click', () => {
  const errEl = document.getElementById('bulk-err');
  errEl.hidden = true;
  document.getElementById('bulk-result').hidden = true;
  const text = document.getElementById('bulk-csv-text').value;
  const rows = parseCSV(text);
  if (rows.length < 2) {
    errEl.textContent = 'ヘッダー行とデータ行が必要です';
    errEl.hidden = false;
    return;
  }
  const headerMap = mapHeader(rows[0]);
  if (headerMap.category === undefined || headerMap.name === undefined) {
    errEl.textContent = 'ヘッダーに category(カテゴリ) と name(名称) の列が見つかりません';
    errEl.hidden = false;
    return;
  }

  bulkParsedRows = rows.slice(1).map((cols) => ({
    category: (cols[headerMap.category] || '').trim(),
    name: (cols[headerMap.name] || '').trim(),
    spec: headerMap.spec !== undefined ? (cols[headerMap.spec] || '').trim() : '',
    serial_number: headerMap.serial_number !== undefined ? (cols[headerMap.serial_number] || '').trim() : '',
    status: headerMap.status !== undefined ? (cols[headerMap.status] || '').trim() : '',
    purchase_date: headerMap.purchase_date !== undefined ? (cols[headerMap.purchase_date] || '').trim() : '',
    notes: headerMap.notes !== undefined ? (cols[headerMap.notes] || '').trim() : '',
  }));

  const validStatuses = ['正常', '故障', '廃棄', 'normal', 'broken', 'retired', ''];
  let validCount = 0;
  const tbody = document.getElementById('bulk-preview-tbody');
  tbody.innerHTML = bulkParsedRows.map((r, i) => {
    let error = '';
    if (!r.category) error = 'カテゴリが空です';
    else if (!r.name) error = '名称が空です';
    else if (!validStatuses.includes(r.status)) error = `不正なステータス: ${r.status}`;
    if (!error) validCount++;
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.category)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.spec)}</td>
      <td>${escapeHtml(r.serial_number)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(r.purchase_date)}</td>
      <td>${escapeHtml(r.notes)}</td>
      <td>${error ? `<span class="row-error">${escapeHtml(error)}</span>` : '<span class="row-ok">OK</span>'}</td>
    </tr>`;
  }).join('');
  document.getElementById('bulk-preview-count').textContent = `${bulkParsedRows.length}件中 ${validCount}件が登録可能`;
  document.getElementById('bulk-preview-wrap').hidden = false;
  document.getElementById('btn-bulk-submit').disabled = validCount === 0;
});

document.getElementById('btn-bulk-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('bulk-err');
  errEl.hidden = true;
  try {
    const res = await api('/api/parts/bulk', { method: 'POST', body: JSON.stringify({ parts: bulkParsedRows }) });
    const resultEl = document.getElementById('bulk-result');
    let msg = `${res.created.length}件登録しました。`;
    if (res.errors.length) {
      msg += ` (${res.errors.length}件エラー: ${res.errors.map((e) => `${e.row}行目 - ${e.error}`).join(' / ')})`;
    }
    resultEl.textContent = msg;
    resultEl.hidden = false;
    document.getElementById('btn-bulk-submit').disabled = true;
    await loadParts();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

/* ---- パーツ履歴ダイアログ ---- */
const dlgPartHistory = document.getElementById('dlg-part-history');
document.getElementById('btn-part-history-close').addEventListener('click', () => dlgPartHistory.close());

async function openPartHistory(id) {
  const part = await api(`/api/parts/${id}`);
  document.getElementById('part-history-title').textContent = `割り当て履歴: ${part.name}`;
  const tbody = document.getElementById('part-history-tbody');
  const empty = document.getElementById('part-history-empty');
  if (!part.history.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
  } else {
    empty.hidden = true;
    tbody.innerHTML = part.history.map((h) => `<tr>
      <td>${escapeHtml(h.server_name || '(削除済みサーバー)')}</td>
      <td>${fmtDate(h.installed_at)}</td>
      <td>${h.removed_at ? fmtDate(h.removed_at) : '<em>使用中</em>'}</td>
      <td>${escapeHtml(h.notes) || '-'}</td>
    </tr>`).join('');
  }
  dlgPartHistory.showModal();
}

/* ================= サーバー一覧 ================= */

async function loadServers() {
  const params = new URLSearchParams();
  const q = document.getElementById('servers-search').value.trim();
  if (q) params.set('q', q);
  serversCache = await api(`/api/servers?${params.toString()}`);
  renderServersTable();
}

function renderServersTable() {
  const tbody = document.getElementById('servers-tbody');
  const empty = document.getElementById('servers-empty');
  if (!serversCache.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  tbody.innerHTML = serversCache.map((s) => `<tr>
    <td data-label="サーバー名"><button class="server-link" data-open-server="${s.id}">${escapeHtml(s.name)}</button></td>
    <td data-label="設置場所">${escapeHtml(s.location) || '-'}</td>
    <td data-label="ステータス">${escapeHtml(s.status) || '-'}</td>
    <td data-label="搭載パーツ数">${s.current_parts_count}</td>
    <td data-label="操作"><div class="row-actions">
      <button class="link" data-open-server="${s.id}">構成を見る</button>
      <button class="link" data-edit-server="${s.id}">編集</button>
      <button class="link" data-delete-server="${s.id}">削除</button>
    </div></td>
  </tr>`).join('');
}

document.getElementById('servers-search').addEventListener('input', debounce(loadServers, 250));

document.getElementById('servers-tbody').addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.openServer) return openServerDetail(Number(t.dataset.openServer));
  if (t.dataset.editServer) return openServerDialog(Number(t.dataset.editServer));
  if (t.dataset.deleteServer) return deleteServer(Number(t.dataset.deleteServer));
});

async function deleteServer(id) {
  if (!confirm('このサーバーを削除します。よろしいですか？')) return;
  try {
    await api(`/api/servers/${id}`, { method: 'DELETE' });
    await loadServers();
  } catch (err) {
    alert(err.message);
  }
}

/* ---- サーバー登録/編集ダイアログ ---- */
const dlgServer = document.getElementById('dlg-server');
document.getElementById('btn-new-server').addEventListener('click', () => openServerDialog(null));
document.getElementById('btn-server-cancel').addEventListener('click', () => dlgServer.close());

function openServerDialog(id) {
  document.getElementById('server-err').hidden = true;
  document.getElementById('form-server').reset();
  document.getElementById('server-id').value = id || '';
  if (id) {
    const s = serversCache.find((x) => x.id === id);
    document.getElementById('server-dlg-title').textContent = 'サーバーを編集';
    document.getElementById('server-name').value = s.name;
    document.getElementById('server-location').value = s.location;
    document.getElementById('server-status').value = s.status;
    document.getElementById('server-notes').value = s.notes;
  } else {
    document.getElementById('server-dlg-title').textContent = '新規サーバー登録';
  }
  dlgServer.showModal();
}

document.getElementById('form-server').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('server-id').value;
  const payload = {
    name: document.getElementById('server-name').value.trim(),
    location: document.getElementById('server-location').value.trim(),
    status: document.getElementById('server-status').value.trim(),
    notes: document.getElementById('server-notes').value.trim(),
  };
  try {
    if (id) {
      await api(`/api/servers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/servers', { method: 'POST', body: JSON.stringify(payload) });
    }
    dlgServer.close();
    await loadServers();
  } catch (err) {
    const el = document.getElementById('server-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

/* ---- サーバー詳細（構成）ダイアログ ---- */
const dlgServerDetail = document.getElementById('dlg-server-detail');
document.getElementById('btn-server-detail-close').addEventListener('click', () => dlgServerDetail.close());
dlgServerDetail.addEventListener('close', () => { currentDetailServerId = null; });
let currentDetailServerId = null;

async function openServerDetail(id) {
  currentDetailServerId = id;
  const s = await api(`/api/servers/${id}`);
  document.getElementById('server-detail-title').textContent = `構成: ${s.name}`;
  document.getElementById('server-detail-meta').textContent =
    `設置場所: ${s.location || '-'} ／ ステータス: ${s.status || '-'} ／ 搭載パーツ数: ${s.current_parts_count}`;

  const cfgBody = document.getElementById('server-detail-config-tbody');
  const cfgEmpty = document.getElementById('server-detail-config-empty');
  if (!s.current_config.length) {
    cfgBody.innerHTML = '';
    cfgEmpty.hidden = false;
  } else {
    cfgEmpty.hidden = true;
    cfgBody.innerHTML = s.current_config.map((c) => `<tr>
      <td>${escapeHtml(c.category)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.spec) || '-'}</td>
      <td>${escapeHtml(c.serial_number) || '-'}</td>
      <td>${fmtDate(c.installed_at)}</td>
      <td><div class="row-actions">
        <button class="link" data-detail-remove="${c.assignment_id}">取り外す</button>
        <button class="link" data-detail-move="${c.assignment_id}" data-detail-move-name="${escapeHtml(c.name)}">移動</button>
      </div></td>
    </tr>`).join('');
  }

  const histBody = document.getElementById('server-detail-history-tbody');
  const histEmpty = document.getElementById('server-detail-history-empty');
  const pastHistory = s.history.filter((h) => h.removed_at);
  if (!pastHistory.length) {
    histBody.innerHTML = '';
    histEmpty.hidden = false;
  } else {
    histEmpty.hidden = true;
    histBody.innerHTML = pastHistory.map((h) => `<tr>
      <td>${escapeHtml(h.category)}</td>
      <td>${escapeHtml(h.name)}</td>
      <td>${fmtDate(h.installed_at)}</td>
      <td>${fmtDate(h.removed_at)}</td>
    </tr>`).join('');
  }

  dlgServerDetail.showModal();
}

document.getElementById('server-detail-config-tbody').addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.detailRemove) return removeAssignment(Number(t.dataset.detailRemove)).then(refreshServerDetail);
  if (t.dataset.detailMove) return openMoveDialog(Number(t.dataset.detailMove), t.dataset.detailMoveName, true);
});

async function refreshServerDetail() {
  if (currentDetailServerId) await openServerDetail(currentDetailServerId);
}

document.getElementById('btn-server-detail-assign').addEventListener('click', () => {
  openAssignDialog({ serverId: currentDetailServerId });
});

/* ================= 割り当てダイアログ ================= */
const dlgAssign = document.getElementById('dlg-assign');
document.getElementById('btn-assign-cancel').addEventListener('click', () => dlgAssign.close());

async function openAssignDialog({ partId, serverId }) {
  document.getElementById('assign-err').hidden = true;
  document.getElementById('form-assign').reset();
  document.getElementById('assign-date').value = todayInputValue();

  const partLabel = document.getElementById('assign-part-picker-label');
  const serverLabel = document.getElementById('assign-server-picker-label');
  const partSelect = document.getElementById('assign-part-select');
  const serverSelect = document.getElementById('assign-server-select');

  if (partId) {
    // パーツ行からの起動: パーツ固定、サーバーを選ぶ
    partLabel.hidden = true;
    serverLabel.hidden = false;
    partSelect.innerHTML = `<option value="${partId}"></option>`;
    document.getElementById('assign-part-id').value = partId;
    const part = partsCache.find((p) => p.id === partId) || await api(`/api/parts/${partId}`);
    document.getElementById('assign-dlg-title').textContent = `割り当てる: ${part.name}`;
    if (!serversCache.length) await loadServers();
    serverSelect.innerHTML = serversCache.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  } else if (serverId) {
    // サーバー詳細からの起動: サーバー固定、在庫パーツを選ぶ
    partLabel.hidden = false;
    serverLabel.hidden = true;
    document.getElementById('assign-server-id').value = serverId;
    const server = serversCache.find((s) => s.id === serverId);
    document.getElementById('assign-dlg-title').textContent = `パーツを割り当てる: ${server ? server.name : ''}`;
    const stockParts = await api('/api/parts?assignment_state=in_stock');
    if (!stockParts.length) {
      partSelect.innerHTML = '<option value="">(在庫パーツがありません)</option>';
    } else {
      partSelect.innerHTML = stockParts
        .map((p) => `<option value="${p.id}">${escapeHtml(p.category)} / ${escapeHtml(p.name)}${p.serial_number ? ' (' + escapeHtml(p.serial_number) + ')' : ''}</option>`)
        .join('');
    }
  }
  dlgAssign.showModal();
}

document.getElementById('form-assign').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fixedPartId = document.getElementById('assign-part-id').value;
  const fixedServerId = document.getElementById('assign-server-id').value;
  const part_id = fixedPartId || document.getElementById('assign-part-select').value;
  const server_id = fixedServerId || document.getElementById('assign-server-select').value;
  if (!part_id || !server_id) {
    const el = document.getElementById('assign-err');
    el.textContent = 'パーツとサーバーを選択してください';
    el.hidden = false;
    return;
  }
  const dateVal = document.getElementById('assign-date').value;
  const payload = {
    part_id: Number(part_id),
    server_id: Number(server_id),
    installed_at: dateVal ? new Date(dateVal).toISOString() : undefined,
    notes: document.getElementById('assign-notes').value.trim(),
  };
  try {
    await api('/api/assignments', { method: 'POST', body: JSON.stringify(payload) });
    dlgAssign.close();
    await refreshAll();
    if (dlgServerDetail.open && currentDetailServerId) await refreshServerDetail();
  } catch (err) {
    const el = document.getElementById('assign-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

/* ================= 移動ダイアログ ================= */
const dlgMove = document.getElementById('dlg-move');
document.getElementById('btn-move-cancel').addEventListener('click', () => dlgMove.close());
let moveFromDetail = false;

async function openMoveDialog(assignmentId, partName, fromDetail) {
  moveFromDetail = !!fromDetail;
  document.getElementById('move-err').hidden = true;
  document.getElementById('form-move').reset();
  document.getElementById('move-assignment-id').value = assignmentId;
  document.getElementById('move-current-info').textContent = `対象パーツ: ${partName || ''}`;
  if (!serversCache.length) await loadServers();
  const sel = document.getElementById('move-server-select');
  sel.innerHTML = serversCache.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  dlgMove.showModal();
}

document.getElementById('form-move').addEventListener('submit', async (e) => {
  e.preventDefault();
  const assignmentId = document.getElementById('move-assignment-id').value;
  const server_id = document.getElementById('move-server-select').value;
  const notes = document.getElementById('move-notes').value.trim();
  try {
    await api(`/api/assignments/${assignmentId}/move`, { method: 'POST', body: JSON.stringify({ server_id: Number(server_id), notes }) });
    dlgMove.close();
    await refreshAll();
    if (moveFromDetail && dlgServerDetail.open && currentDetailServerId) await refreshServerDetail();
  } catch (err) {
    const el = document.getElementById('move-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

/* ================= 初期化 ================= */
async function refreshAll() {
  await Promise.all([loadParts(), loadServers()]);
}

refreshAll().catch((err) => alert(`データの読み込みに失敗しました: ${err.message}`));
