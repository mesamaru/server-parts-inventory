/* eslint-disable no-alert */

/* ---------- テーマ（ライト/ダーク/端末に合わせる） ---------- */
// 初回のCSS適用は index.html の head 内インラインスクリプトで行う（ちらつき防止のため）。
// ここでは設定画面の初期値表示と、変更時の切り替えを担当する。
let themePref = 'system';
try {
  themePref = localStorage.getItem('themePref') || 'system';
} catch { /* プライベートモード等でlocalStorageが使えない場合は既定値のまま */ }

function applyTheme(pref) {
  if (pref === 'light' || pref === 'dark') {
    document.documentElement.setAttribute('data-theme', pref);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

let partsCache = [];
let serversCache = [];
let allCategories = [];
let selectedPartIds = new Set();
let lastCheckedPartId = null;
const filterState = { categories: new Set(), states: new Set(), statuses: new Set() };

/* ---------- アイコン ---------- */
const svgIcon = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICON = {
  unassign: svgIcon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  move: svgIcon('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  history: svgIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  edit: svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  trash: svgIcon('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  view: svgIcon('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  server: svgIcon('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'),
  check: svgIcon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  alert: svgIcon('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  archive: svgIcon('<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>'),
  package: svgIcon('<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
  terminal: svgIcon('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'),
};

const STATUS_ICON = {
  normal: { icon: ICON.check, label: '正常', cls: 'st-normal' },
  broken: { icon: ICON.alert, label: '故障', cls: 'st-broken' },
  retired: { icon: ICON.archive, label: '廃棄', cls: 'st-retired' },
};

const STATE_ICON = {
  in_stock: { icon: ICON.package, label: '在庫', cls: 'st-stock' },
  assigned: { icon: ICON.server, label: '使用中', cls: 'st-assigned' },
};

/* ---------- カテゴリ表記（通常 / 略記） ---------- */
const CATEGORY_SHORT = {
  CPU: 'CPU',
  'メモリ': 'MEM',
  'ストレージ': 'STG',
  'マザーボード': 'MB',
  '電源(PSU)': 'PSU',
  GPU: 'GPU',
  NIC: 'NIC',
  'RAIDカード': 'RAID',
  '冷却ファン': 'FAN',
  'ケース': 'CASE',
  'その他': 'ETC',
};

let categoryDisplay = 'full';
try {
  categoryDisplay = localStorage.getItem('categoryDisplay') || 'full';
} catch { /* プライベートモード等でlocalStorageが使えない場合は既定値のまま */ }

function categoryLabel(category) {
  return categoryDisplay === 'short' ? (CATEGORY_SHORT[category] || category) : category;
}

function statusIcon(map, key) {
  const entry = map[key];
  if (!entry) return '-';
  return `<span class="status-icon ${entry.cls}" role="img" title="${entry.label}" aria-label="${entry.label}">${entry.icon}</span>`;
}

/* ---------- カテゴリ別の入力補助定義 ---------- */
// makers: メーカーのトグル候補 / fields: スペックを組み立てる入力欄
// compose: 入力値から「スペック詳細」の文字列を組み立てる
const CATEGORY_PRESETS = {
  CPU: {
    makers: ['Intel', 'AMD'],
    fields: [
      { key: 'cores', label: 'コア数', type: 'number', min: 1, max: 256, step: 1, unit: 'コア' },
      { key: 'threads', label: 'スレッド数', type: 'number', min: 1, max: 512, step: 1, unit: 'スレッド' },
      { key: 'clock', label: 'クロック', type: 'number', min: 0, max: 10, step: 0.1, unit: 'GHz' },
    ],
    compose: (v) => [
      [v.cores && `${v.cores}コア`, v.threads && `${v.threads}スレッド`].filter(Boolean).join(' / '),
      v.clock && `${v.clock}GHz`,
    ].filter(Boolean).join(' '),
  },
  'メモリ': {
    makers: ['Samsung', 'Micron / Crucial', 'SK hynix', 'Kingston', 'CFD'],
    fields: [
      { key: 'capacity', label: '容量', type: 'number', min: 1, max: 1024, step: 1, unit: 'GB' },
      { key: 'ddr', label: '規格 (DDR)', type: 'number', min: 1, max: 6, step: 1, prefix: 'DDR' },
      { key: 'speed', label: '速度', type: 'number', min: 100, max: 12800, step: 100, unit: 'MT/s' },
      { key: 'form', label: '形状', type: 'toggle', options: ['DIMM', 'SODIMM'] },
      { key: 'ecc', label: 'ECC', type: 'toggle', options: ['ECC', 'non-ECC'] },
    ],
    compose: (v) => [
      v.capacity && `${v.capacity}GB`,
      v.ddr && `DDR${v.ddr}`,
      v.speed && `${v.speed}MT/s`,
      v.form,
      v.ecc === 'ECC' ? 'ECC' : '',
    ].filter(Boolean).join(' '),
  },
  'ストレージ': {
    makers: ['Samsung', 'Western Digital', 'Seagate', 'Crucial', 'Kioxia', 'Intel'],
    fields: [
      { key: 'capacity', label: '容量', type: 'number', min: 1, max: 100000, step: 1 },
      { key: 'unit', label: '単位', type: 'toggle', options: ['GB', 'TB'] },
      { key: 'kind', label: '種別', type: 'toggle', options: ['HDD', 'SSD', 'NVMe'] },
    ],
    compose: (v) => [v.capacity && `${v.capacity}${v.unit || 'GB'}`, v.kind].filter(Boolean).join(' '),
  },
  GPU: {
    makers: ['NVIDIA', 'AMD', 'Intel'],
    fields: [
      { key: 'vram', label: 'VRAM', type: 'number', min: 1, max: 256, step: 1, unit: 'GB' },
      { key: 'bus', label: '接続', type: 'toggle', options: ['PCIe x16', 'PCIe x8', 'オンボード'] },
    ],
    compose: (v) => [v.vram && `VRAM ${v.vram}GB`, v.bus].filter(Boolean).join(' '),
  },
  NIC: {
    makers: ['Intel', 'Realtek', 'Broadcom', 'Mellanox'],
    fields: [
      { key: 'speed', label: '速度', type: 'toggle', options: ['1GbE', '2.5GbE', '10GbE', '25GbE', '40GbE'] },
      { key: 'ports', label: 'ポート数', type: 'number', min: 1, max: 8, step: 1, unit: 'ポート' },
    ],
    compose: (v) => [v.speed, v.ports && `${v.ports}ポート`].filter(Boolean).join(' '),
  },
  'マザーボード': {
    makers: ['ASUS', 'ASRock', 'GIGABYTE', 'MSI', 'Supermicro'],
    fields: [
      { key: 'form', label: 'フォームファクタ', type: 'toggle', options: ['ATX', 'MicroATX', 'Mini-ITX', 'E-ATX'] },
      { key: 'socket', label: 'ソケット', type: 'toggle', options: ['LGA1700', 'LGA1200', 'LGA2011', 'AM4', 'AM5'] },
    ],
    compose: (v) => [v.form, v.socket].filter(Boolean).join(' '),
  },
  '電源(PSU)': {
    makers: ['Corsair', 'Seasonic', '玄人志向', 'Antec', 'Thermaltake'],
    fields: [
      { key: 'watt', label: '容量', type: 'number', min: 100, max: 2000, step: 50, unit: 'W' },
      { key: 'rank', label: '80PLUS', type: 'toggle', options: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Titanium'] },
    ],
    compose: (v) => [v.watt && `${v.watt}W`, v.rank && `80PLUS ${v.rank}`].filter(Boolean).join(' '),
  },
  'RAIDカード': {
    makers: ['LSI / Broadcom', 'Adaptec', 'Dell PERC', 'HPE Smart Array'],
    fields: [
      { key: 'ports', label: 'ポート数', type: 'number', min: 1, max: 32, step: 1, unit: 'ポート' },
      { key: 'mode', label: 'モード', type: 'toggle', options: ['RAID', 'HBA / IT'] },
    ],
    compose: (v) => [v.ports && `${v.ports}ポート`, v.mode].filter(Boolean).join(' '),
  },
};

function iconBtn(icon, label, dataAttr, danger = false) {
  return `<button type="button" class="icon-btn${danger ? ' icon-danger' : ''}" title="${label}" aria-label="${label}" ${dataAttr}>${icon}</button>`;
}

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
  // ログイン失敗の401はそのままエラーを返す。それ以外の401はセッション切れとして扱う。
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    showAuthScreen({ setup_required: false });
    throw new Error('セッションが切れました。再度ログインしてください。');
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
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    // 集計・履歴系は開いたときに最新を取りに行く
    try {
      if (btn.dataset.tab === 'dashboard') await loadDashboard();
      if (btn.dataset.tab === 'history') await reloadHistoryTab();
      if (btn.dataset.tab === 'sync') {
        await loadSyncReports();
        await loadCommandBuilder();
      }
    } catch (err) {
      alert(err.message);
    }
  });
});

/* ================= パーツ一覧 ================= */

async function loadParts() {
  const params = new URLSearchParams();
  const q = document.getElementById('parts-search').value.trim();
  if (q) params.set('q', q);
  filterState.categories.forEach((c) => params.append('category', c));
  filterState.states.forEach((s) => params.append('assignment_state', s));
  filterState.statuses.forEach((s) => params.append('status', s));
  partsCache = await api(`/api/parts?${params.toString()}`);
  const validIds = new Set(partsCache.map((p) => p.id));
  [...selectedPartIds].forEach((id) => { if (!validIds.has(id)) selectedPartIds.delete(id); });
  // 件数が変わるとページ位置がずれるので先頭に戻す
  currentPage = 1;
  renderPartsTable();
}

// カテゴリが増減しうる操作のあとに使う（フィルタのカテゴリ一覧も合わせて更新する）
async function reloadParts() {
  await Promise.all([loadParts(), loadCategories()]);
}

/* ---- フィルタ ---- */

async function loadCategories() {
  allCategories = await api('/api/parts/categories');
  renderFilterCategories();
}

function renderFilterCategories() {
  const wrap = document.getElementById('filter-category-list');
  if (!allCategories.length) {
    wrap.innerHTML = '<p class="empty-note">カテゴリがまだありません</p>';
    return;
  }
  wrap.innerHTML = allCategories.map((c) => `<label>
    <input type="checkbox" data-filter-group="categories" value="${escapeHtml(c)}" ${filterState.categories.has(c) ? 'checked' : ''} />
    ${escapeHtml(c)}
  </label>`).join('');
}

function updateFilterBadge() {
  const count = filterState.categories.size + filterState.states.size + filterState.statuses.size;
  const badge = document.getElementById('filter-badge');
  badge.textContent = count;
  badge.hidden = count === 0;
  document.getElementById('btn-filter').classList.toggle('has-filter', count > 0);
}

const filterPanel = document.getElementById('filter-panel');

document.getElementById('btn-filter').addEventListener('click', (e) => {
  e.stopPropagation();
  filterPanel.hidden = !filterPanel.hidden;
});

document.getElementById('btn-filter-close').addEventListener('click', () => { filterPanel.hidden = true; });

document.addEventListener('click', (e) => {
  if (!filterPanel.hidden && !e.target.closest('.filter-wrap')) filterPanel.hidden = true;
});

filterPanel.addEventListener('change', async (e) => {
  const group = e.target.dataset.filterGroup;
  if (!group) return;
  const set = filterState[group];
  if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
  updateFilterBadge();
  await loadParts();
});

document.getElementById('btn-filter-clear').addEventListener('click', async () => {
  filterState.categories.clear();
  filterState.states.clear();
  filterState.statuses.clear();
  filterPanel.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
  updateFilterBadge();
  await loadParts();
});

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ---- 並び替え・ページング ---- */
let sortKey = 'category';
let sortDir = 'asc';
let currentPage = 1;
let pageSize = 50;

const STATUS_ORDER = { normal: 0, broken: 1, retired: 2 };

function sortValue(part, key) {
  if (key === 'location') return part.current_server_name || '￿在庫';
  if (key === 'status') return STATUS_ORDER[part.status] ?? 9;
  if (key === 'created_at') return part.created_at || '';
  return part[key] || '';
}

function sortedParts() {
  const sorted = [...partsCache].sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    let cmp;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb), 'ja');
    if (cmp === 0) cmp = a.name.localeCompare(b.name, 'ja');
    return sortDir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

// 現在のページに表示しているパーツ（全選択やページャの基準になる）
function pageParts() {
  const sorted = sortedParts();
  if (!pageSize) return sorted;
  const start = (currentPage - 1) * pageSize;
  return sorted.slice(start, start + pageSize);
}

function renderPager(total, shown) {
  const pager = document.getElementById('parts-pager');
  pager.hidden = total === 0;
  const start = pageSize ? (currentPage - 1) * pageSize + 1 : 1;
  const end = pageSize ? start + shown - 1 : total;
  document.getElementById('pager-info').textContent = total ? `${start}〜${end}件 / 全${total}件` : '';
  const lastPage = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  document.getElementById('pager-prev').disabled = currentPage <= 1;
  document.getElementById('pager-next').disabled = currentPage >= lastPage;
}

function renderSortIndicators() {
  document.querySelectorAll('#tab-parts th.sortable').forEach((th) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortKey) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

document.querySelectorAll('#tab-parts th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = key; sortDir = 'asc'; }
    currentPage = 1;
    renderPartsTable();
  });
});

document.getElementById('pager-prev').addEventListener('click', () => {
  if (currentPage > 1) { currentPage--; renderPartsTable(); }
});
document.getElementById('pager-next').addEventListener('click', () => {
  currentPage++;
  renderPartsTable();
});
document.getElementById('page-size').addEventListener('change', (e) => {
  pageSize = Number(e.target.value);
  currentPage = 1;
  renderPartsTable();
});

function renderPartsTable() {
  const tbody = document.getElementById('parts-tbody');
  const empty = document.getElementById('parts-empty');
  renderSortIndicators();
  if (!partsCache.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    renderPager(0, 0);
    updateBulkBar();
    return;
  }
  empty.hidden = true;
  const rows = pageParts();
  // 削除などで最終ページが消えた場合は1ページ戻す
  if (!rows.length && currentPage > 1) {
    currentPage--;
    renderPartsTable();
    return;
  }
  renderPager(partsCache.length, rows.length);
  tbody.innerHTML = rows.map((p) => {
    const location = p.current_server_id
      ? `<button class="server-link" data-open-server="${p.current_server_id}">${escapeHtml(p.current_server_name || '')}</button>`
      : '在庫';
    const isAssigned = !!p.current_assignment_id;
    const canAssign = p.status === 'normal' && !isAssigned;
    const actions = [];
    if (isAssigned || canAssign) {
      const label = isAssigned ? 'サーバー割り当て（移動・取り外し）' : 'サーバーに割り当てる';
      actions.push(iconBtn(ICON.server, label, `data-part-server="${p.id}"`));
    }
    actions.push(iconBtn(ICON.edit, '編集', `data-edit-part="${p.id}"`));
    actions.push(iconBtn(ICON.history, '履歴', `data-part-history="${p.id}"`));
    actions.push(iconBtn(ICON.trash, '削除', `data-delete-part="${p.id}"`, true));
    return `<tr>
      <td data-label=""><input type="checkbox" class="row-check" data-row-check="${p.id}" ${selectedPartIds.has(p.id) ? 'checked' : ''} /></td>
      <td data-label="カテゴリ" class="cell-category">${escapeHtml(categoryLabel(p.category))}</td>
      <td data-label="名称">${p.maker ? `<span class="maker-tag">${escapeHtml(p.maker)}</span>` : ''}${escapeHtml(p.name)}</td>
      <td data-label="スペック">${escapeHtml(p.spec) || '-'}</td>
      <td data-label="シリアル番号">${escapeHtml(p.serial_number) || '-'}</td>
      <td data-label="ステータス">${statusIcon(STATUS_ICON, p.status)}</td>
      <td data-label="状態／割当先"><span class="state-cell">${statusIcon(STATE_ICON, p.assignment_state)}${location}</span></td>
      <td data-label="登録日">${fmtDate(p.created_at)}</td>
      <td data-label="操作"><div class="row-actions">${actions.join('')}</div></td>
    </tr>`;
  }).join('');
  updateBulkBar();
}

function syncRowCheckboxes() {
  document.querySelectorAll('#parts-tbody .row-check').forEach((cb) => {
    cb.checked = selectedPartIds.has(Number(cb.dataset.rowCheck));
  });
}

function updateBulkBar() {
  const bar = document.getElementById('parts-bulk-bar');
  const count = selectedPartIds.size;
  document.getElementById('parts-bulk-count').textContent = count;
  bar.hidden = count === 0;

  // 全選択チェックは「今表示しているページ」を対象にする
  const selectAll = document.getElementById('parts-select-all');
  const visibleIds = pageParts().map((p) => p.id);
  const selectedVisible = visibleIds.filter((id) => selectedPartIds.has(id));
  selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
}

document.getElementById('parts-select-all').addEventListener('change', (e) => {
  pageParts().forEach((p) => {
    if (e.target.checked) selectedPartIds.add(p.id);
    else selectedPartIds.delete(p.id);
  });
  syncRowCheckboxes();
  updateBulkBar();
});

document.getElementById('btn-bulk-clear').addEventListener('click', () => {
  selectedPartIds.clear();
  syncRowCheckboxes();
  updateBulkBar();
});

const categoryDisplaySelect = document.getElementById('category-display');
categoryDisplaySelect.value = categoryDisplay;
categoryDisplaySelect.addEventListener('change', async (e) => {
  categoryDisplay = e.target.value;
  try {
    localStorage.setItem('categoryDisplay', categoryDisplay);
  } catch { /* 保存できなくても表示自体は切り替える */ }
  renderPartsTable();
  if (dlgServerDetail.open && currentDetailServerId) await refreshServerDetail();
});

const themeSelect = document.getElementById('theme-select');
themeSelect.value = themePref;
themeSelect.addEventListener('change', (e) => {
  themePref = e.target.value;
  applyTheme(themePref);
  try {
    localStorage.setItem('themePref', themePref);
  } catch { /* 保存できなくても表示自体は切り替える */ }
});

/* ---- モバイル幅でのハンバーガーメニュー ---- */
const mainTabs = document.getElementById('main-tabs');
const navToggle = document.getElementById('btn-nav-toggle');
navToggle.addEventListener('click', () => {
  const open = mainTabs.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(open));
});
// タブを選んだらメニューは自動で閉じる（スマホ幅で開いたままにしない）
mainTabs.addEventListener('click', (e) => {
  if (e.target.closest('.tab-btn')) {
    mainTabs.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
});

document.getElementById('parts-search').addEventListener('input', debounce(loadParts, 250));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.getElementById('parts-tbody').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.rowCheck) {
    const id = Number(t.dataset.rowCheck);
    const ids = pageParts().map((p) => p.id);
    // Shift+クリックで直前に操作した行からの範囲をまとめて切り替える
    if (e.shiftKey && lastCheckedPartId !== null && ids.includes(lastCheckedPartId)) {
      const from = ids.indexOf(lastCheckedPartId);
      const to = ids.indexOf(id);
      const [start, end] = from < to ? [from, to] : [to, from];
      for (let i = start; i <= end; i++) {
        if (t.checked) selectedPartIds.add(ids[i]);
        else selectedPartIds.delete(ids[i]);
      }
      syncRowCheckboxes();
    } else if (t.checked) {
      selectedPartIds.add(id);
    } else {
      selectedPartIds.delete(id);
    }
    lastCheckedPartId = id;
    updateBulkBar();
    return;
  }
  if (t.dataset.openServer) return openServerDetail(Number(t.dataset.openServer));
  if (t.dataset.partServer) return openPartServerDialog(Number(t.dataset.partServer));
  if (t.dataset.partHistory) return openPartHistory(Number(t.dataset.partHistory));
  if (t.dataset.editPart) return openPartDialog(Number(t.dataset.editPart));
  if (t.dataset.deletePart) return deletePart(Number(t.dataset.deletePart));
});

/* ---- ダイアログを閉じたときの後始末 ---- */
// close イベントを発火しない環境があるため、閉じる処理は必ずこの関数を通し、
// 後始末は明示的に呼ぶ。closeイベントが飛ぶ環境でも二重に走らないよう、
// 登録する処理は冪等にしておくこと。
const afterCloseHooks = new Map();

function registerAfterClose(dialog, handler) {
  afterCloseHooks.set(dialog, handler);
  dialog.addEventListener('close', handler);
  dialog.addEventListener('cancel', handler);
}

function closeDialog(dialog) {
  dialog.close();
  const handler = afterCloseHooks.get(dialog);
  if (handler) handler();
}

/* ---- 確認ダイアログ ---- */
const dlgConfirm = document.getElementById('dlg-confirm');
let confirmResolve = null;

function confirmDialog({ title = '確認', message, okLabel = 'OK', danger = false }) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  const okBtn = document.getElementById('btn-confirm-ok');
  okBtn.textContent = okLabel;
  okBtn.className = danger ? 'danger' : 'primary';
  dlgConfirm.showModal();
  return new Promise((resolve) => { confirmResolve = resolve; });
}

// 未解決なら決着させる。既に解決済みなら何もしない（冪等）
function settleConfirm(result) {
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(result);
}

document.getElementById('btn-confirm-ok').addEventListener('click', () => {
  settleConfirm(true);
  dlgConfirm.close();
});
// ×/Escape/キャンセル/背景クリックはキャンセル扱い
document.getElementById('btn-confirm-cancel').addEventListener('click', () => closeDialog(dlgConfirm));
document.getElementById('btn-confirm-close').addEventListener('click', () => closeDialog(dlgConfirm));
registerAfterClose(dlgConfirm, () => settleConfirm(false));

async function removeAssignment(assignmentId) {
  const ok = await confirmDialog({
    title: 'パーツの取り外し',
    message: 'このパーツを取り外して在庫に戻します。よろしいですか？',
    okLabel: '取り外す',
  });
  if (!ok) return;
  try {
    await api(`/api/assignments/${assignmentId}/remove`, { method: 'POST', body: JSON.stringify({}) });
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
}

async function deletePart(id) {
  const part = partsCache.find((p) => p.id === id);
  const ok = await confirmDialog({
    title: 'パーツの削除',
    message: `「${part ? part.name : ''}」を削除します。\nこの操作は取り消せません。よろしいですか？`,
    okLabel: '削除する',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/parts/${id}`, { method: 'DELETE' });
    await reloadParts();
  } catch (err) {
    alert(err.message);
  }
}

/* ---- サーバー割り当てダイアログ（割り当て／移動／取り外し） ---- */
const dlgPartServer = document.getElementById('dlg-part-server');
let partServerTarget = null;

async function openPartServerDialog(partId) {
  const part = partsCache.find((p) => p.id === partId);
  if (!part) return;
  partServerTarget = part;
  const isAssigned = !!part.current_assignment_id;

  document.getElementById('part-server-title').textContent = `サーバー割り当て: ${part.name}`;
  document.getElementById('part-server-current').textContent = isAssigned
    ? `現在: ${part.current_server_name} に割り当て中`
    : '現在: 在庫（どのサーバーにも割り当てられていません）';
  document.getElementById('part-server-select-caption').textContent = 'サーバー';
  document.getElementById('part-server-date').value = todayInputValue();
  document.getElementById('part-server-notes').value = '';
  document.getElementById('part-server-err').hidden = true;
  document.getElementById('btn-part-server-unassign').hidden = !isAssigned;

  if (!serversCache.length) await loadServers();
  // 割り当て済みなら現在のサーバーを選択状態で表示し、プルダウンで他サーバーへ変更できるようにする。
  const select = document.getElementById('part-server-select');
  select.innerHTML = serversCache.map((s) => {
    const isCurrent = s.id === part.current_server_id;
    return `<option value="${s.id}">${escapeHtml(s.name)}${isCurrent ? '（現在）' : ''}</option>`;
  }).join('');
  if (isAssigned) select.value = String(part.current_server_id);

  document.getElementById('btn-part-server-submit').textContent = isAssigned ? '移動する' : '割り当てる';
  syncPartServerSubmit();

  if (!serversCache.length) {
    const err = document.getElementById('part-server-err');
    err.textContent = 'サーバーが登録されていません。先にサーバー一覧から登録してください。';
    err.hidden = false;
  }

  dlgPartServer.showModal();
}

// 現在と同じサーバーが選ばれている間は「移動する」を押せないようにする
function syncPartServerSubmit() {
  const submitBtn = document.getElementById('btn-part-server-submit');
  const selected = Number(document.getElementById('part-server-select').value);
  const current = partServerTarget ? partServerTarget.current_server_id : null;
  submitBtn.disabled = !serversCache.length || (current !== null && selected === current);
}

document.getElementById('part-server-select').addEventListener('change', syncPartServerSubmit);
document.getElementById('btn-part-server-close').addEventListener('click', () => dlgPartServer.close());

document.getElementById('form-part-server').addEventListener('submit', async (e) => {
  e.preventDefault();
  const part = partServerTarget;
  if (!part) return;
  const serverId = Number(document.getElementById('part-server-select').value);
  const dateVal = document.getElementById('part-server-date').value;
  const notes = document.getElementById('part-server-notes').value.trim();
  try {
    if (part.current_assignment_id) {
      await api(`/api/assignments/${part.current_assignment_id}/move`, {
        method: 'POST',
        body: JSON.stringify({ server_id: serverId, notes }),
      });
    } else {
      await api('/api/assignments', {
        method: 'POST',
        body: JSON.stringify({
          part_id: part.id,
          server_id: serverId,
          installed_at: dateVal ? new Date(dateVal).toISOString() : undefined,
          notes,
        }),
      });
    }
    dlgPartServer.close();
    await refreshAll();
  } catch (err) {
    const el = document.getElementById('part-server-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

document.getElementById('btn-part-server-unassign').addEventListener('click', async () => {
  const part = partServerTarget;
  if (!part || !part.current_assignment_id) return;
  const ok = await confirmDialog({
    title: 'パーツの取り外し',
    message: `「${part.name}」を ${part.current_server_name} から取り外して在庫に戻します。よろしいですか？`,
    okLabel: '取り外す',
  });
  if (!ok) return;
  try {
    await api(`/api/assignments/${part.current_assignment_id}/remove`, { method: 'POST', body: JSON.stringify({}) });
    dlgPartServer.close();
    await refreshAll();
  } catch (err) {
    const el = document.getElementById('part-server-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

/* ---- 一括操作 ---- */

document.getElementById('btn-bulk-delete-open').addEventListener('click', async () => {
  const ids = [...selectedPartIds];
  if (!ids.length) return;
  const ok = await confirmDialog({
    title: 'パーツの一括削除',
    message: `選択中の${ids.length}件のパーツを削除します。\nこの操作は取り消せません。よろしいですか？`,
    okLabel: '削除する',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api('/api/parts/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
    if (res.errors.length) {
      alert(`${res.deleted.length}件削除しました。\n${res.errors.length}件は削除できませんでした:\n` +
        res.errors.map((e) => `#${e.id}: ${e.error}`).join('\n'));
    }
    selectedPartIds.clear();
    await reloadParts();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('btn-bulk-remove-open').addEventListener('click', async () => {
  const ids = new Set(selectedPartIds);
  const targets = partsCache.filter((p) => ids.has(p.id) && p.assignment_state === 'assigned');
  if (!targets.length) {
    alert('選択中に「使用中」のパーツがありません');
    return;
  }
  const ok = await confirmDialog({
    title: 'パーツの一括取り外し',
    message: `${targets.length}件のパーツを取り外して在庫に戻します。よろしいですか？`,
    okLabel: '取り外す',
  });
  if (!ok) return;
  try {
    const res = await api('/api/assignments/bulk-remove', {
      method: 'POST',
      body: JSON.stringify({ assignment_ids: targets.map((p) => p.current_assignment_id) }),
    });
    if (res.errors.length) {
      alert(`${res.removed.length}件取り外しました。\n${res.errors.length}件失敗:\n` +
        res.errors.map((e) => `#${e.id}: ${e.error}`).join('\n'));
    }
    await loadParts();
  } catch (err) {
    alert(err.message);
  }
});

const dlgBulkAssign = document.getElementById('dlg-bulk-assign');
let bulkAssignEligibleIds = [];
document.getElementById('btn-bulk-assign-open').addEventListener('click', async () => {
  const ids = new Set(selectedPartIds);
  const eligible = partsCache.filter((p) => ids.has(p.id) && p.status === 'normal' && p.assignment_state === 'in_stock');
  if (!eligible.length) {
    alert('選択中に割り当て可能な在庫パーツがありません（在庫かつ正常のもののみ対象です）');
    return;
  }
  bulkAssignEligibleIds = eligible.map((p) => p.id);
  document.getElementById('bulk-assign-count').textContent = bulkAssignEligibleIds.length;
  document.getElementById('bulk-assign-date').value = todayInputValue();
  document.getElementById('bulk-assign-notes').value = '';
  document.getElementById('bulk-assign-err').hidden = true;
  if (!serversCache.length) await loadServers();
  document.getElementById('bulk-assign-server-select').innerHTML =
    serversCache.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  dlgBulkAssign.showModal();
});
document.getElementById('btn-bulk-assign-cancel').addEventListener('click', () => dlgBulkAssign.close());
document.getElementById('form-bulk-assign').addEventListener('submit', async (e) => {
  e.preventDefault();
  const server_id = document.getElementById('bulk-assign-server-select').value;
  const dateVal = document.getElementById('bulk-assign-date').value;
  const payload = {
    part_ids: bulkAssignEligibleIds,
    server_id: Number(server_id),
    installed_at: dateVal ? new Date(dateVal).toISOString() : undefined,
    notes: document.getElementById('bulk-assign-notes').value.trim(),
  };
  try {
    const res = await api('/api/assignments/bulk', { method: 'POST', body: JSON.stringify(payload) });
    dlgBulkAssign.close();
    if (res.errors.length) {
      alert(`${res.created.length}件割り当てました。\n${res.errors.length}件失敗:\n` +
        res.errors.map((e) => `#${e.part_id}: ${e.error}`).join('\n'));
    }
    selectedPartIds.clear();
    await loadParts();
  } catch (err) {
    const el = document.getElementById('bulk-assign-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

const dlgBulkEdit = document.getElementById('dlg-bulk-edit');
let bulkEditIds = [];
document.getElementById('btn-bulk-edit-open').addEventListener('click', () => {
  bulkEditIds = [...selectedPartIds];
  if (!bulkEditIds.length) return;
  document.getElementById('bulk-edit-count').textContent = bulkEditIds.length;
  document.getElementById('bulk-edit-category').value = '';
  document.getElementById('bulk-edit-status').value = '';
  document.getElementById('bulk-edit-err').hidden = true;
  dlgBulkEdit.showModal();
});
document.getElementById('btn-bulk-edit-cancel').addEventListener('click', () => dlgBulkEdit.close());
document.getElementById('form-bulk-edit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = document.getElementById('bulk-edit-category').value.trim();
  const status = document.getElementById('bulk-edit-status').value;
  if (!category && !status) {
    const el = document.getElementById('bulk-edit-err');
    el.textContent = 'カテゴリまたはステータスのどちらかを指定してください';
    el.hidden = false;
    return;
  }
  try {
    const res = await api('/api/parts/bulk-edit', {
      method: 'POST',
      body: JSON.stringify({ ids: bulkEditIds, category: category || undefined, status: status || undefined }),
    });
    dlgBulkEdit.close();
    if (res.errors.length) {
      alert(`${res.updated.length}件更新しました。\n${res.errors.length}件失敗:\n` +
        res.errors.map((e) => `#${e.id}: ${e.error}`).join('\n'));
    }
    await reloadParts();
  } catch (err) {
    const el = document.getElementById('bulk-edit-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

/* ---- パーツ登録/編集ダイアログ ---- */
const dlgPart = document.getElementById('dlg-part');
document.getElementById('btn-new-part').addEventListener('click', () => openPartDialog(null));
document.getElementById('btn-part-cancel').addEventListener('click', () => dlgPart.close());

/* ---- カテゴリ別の入力補助 ---- */
let presetMaker = '';
let presetValues = {};

function renderPartPreset() {
  const category = document.getElementById('part-category').value.trim();
  const preset = CATEGORY_PRESETS[category];
  const makers = preset ? preset.makers : [];

  document.getElementById('part-maker-toggles').innerHTML = [...makers, 'その他'].map((m) =>
    `<button type="button" class="toggle-btn${presetMaker === m ? ' selected' : ''}" data-maker="${escapeHtml(m)}">${escapeHtml(m)}</button>`
  ).join('');
  document.getElementById('part-maker-other').hidden = presetMaker !== 'その他';

  const fieldsGroup = document.getElementById('part-fields-group');
  const fieldsWrap = document.getElementById('part-preset-fields');
  if (!preset) {
    fieldsGroup.hidden = true;
    fieldsWrap.innerHTML = '';
    return;
  }
  fieldsGroup.hidden = false;
  fieldsWrap.innerHTML = preset.fields.map((f) => {
    const inner = f.type === 'toggle'
      ? `<div class="toggle-row">${f.options.map((o) =>
          `<button type="button" class="toggle-btn${presetValues[f.key] === o ? ' selected' : ''}" data-preset-toggle="${f.key}" data-preset-value="${escapeHtml(o)}">${escapeHtml(o)}</button>`
        ).join('')}</div>`
      : `<div class="num-with-unit">
          <input type="number" data-preset-num="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${presetValues[f.key] ?? ''}" />
          ${f.unit ? `<span class="unit-label">${escapeHtml(f.unit)}</span>` : ''}
        </div>`;
    return `<div class="preset-field"><span class="preset-field-label">${escapeHtml(f.label)}</span>${inner}</div>`;
  }).join('');
}

function applyPresetToSpec() {
  const category = document.getElementById('part-category').value.trim();
  const preset = CATEGORY_PRESETS[category];
  if (!preset) return;
  const composed = preset.compose(presetValues);
  if (composed) document.getElementById('part-spec').value = composed;
}

document.getElementById('part-category').addEventListener('input', () => {
  presetValues = {};
  renderPartPreset();
});

document.getElementById('part-preset').addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.maker) {
    presetMaker = presetMaker === t.dataset.maker ? '' : t.dataset.maker;
    renderPartPreset();
    return;
  }
  if (t.dataset.presetToggle) {
    const key = t.dataset.presetToggle;
    presetValues[key] = presetValues[key] === t.dataset.presetValue ? '' : t.dataset.presetValue;
    renderPartPreset();
    applyPresetToSpec();
  }
});

document.getElementById('part-preset').addEventListener('input', (e) => {
  const key = e.target.dataset.presetNum;
  if (!key) return;
  presetValues[key] = e.target.value;
  applyPresetToSpec();
});

function openPartDialog(id) {
  document.getElementById('part-err').hidden = true;
  document.getElementById('form-part').reset();
  document.getElementById('part-id').value = id || '';
  document.getElementById('part-status').value = 'normal';
  presetValues = {};
  presetMaker = '';
  if (id) {
    const p = partsCache.find((x) => x.id === id);
    document.getElementById('part-dlg-title').textContent = 'パーツを編集';
    document.getElementById('part-category').value = p.category;
    document.getElementById('part-name').value = p.name;
    document.getElementById('part-spec').value = p.spec;
    document.getElementById('part-serial').value = p.serial_number;
    document.getElementById('part-status').value = p.status;
    document.getElementById('part-purchase-date').value = p.purchase_date ? p.purchase_date.slice(0, 10) : '';
    document.getElementById('part-warranty').value = p.warranty_until ? p.warranty_until.slice(0, 10) : '';
    document.getElementById('part-notes').value = p.notes;
    renderPartPhotos(p);
    if (p.maker) {
      const known = (CATEGORY_PRESETS[p.category] || {}).makers || [];
      presetMaker = known.includes(p.maker) ? p.maker : 'その他';
      if (presetMaker === 'その他') document.getElementById('part-maker-other').value = p.maker;
    }
  } else {
    document.getElementById('part-dlg-title').textContent = '新規パーツ登録';
    // 写真はパーツIDが決まってからでないと添付できない
    document.getElementById('part-photo-box').hidden = true;
    document.getElementById('part-photo-hint').hidden = false;
  }
  renderPartPreset();
  dlgPart.showModal();
}

/* ---- パーツの写真 ---- */
function renderPartPhotos(part) {
  document.getElementById('part-photo-hint').hidden = true;
  const box = document.getElementById('part-photo-box');
  box.hidden = false;
  box.dataset.partId = part.id;
  document.getElementById('part-photo-input').value = '';
  document.getElementById('part-photo-list').innerHTML = (part.photos || []).map((ph) => `<div class="photo-thumb">
    <img src="/api/parts/${part.id}/photos/${ph.id}" alt="" />
    <button type="button" title="削除" aria-label="写真を削除" data-photo-delete="${ph.id}">×</button>
  </div>`).join('');
}

async function refreshPartPhotos(partId) {
  const part = await api(`/api/parts/${partId}`);
  renderPartPhotos(part);
}

document.getElementById('part-photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const partId = document.getElementById('part-photo-box').dataset.partId;
  const errEl = document.getElementById('part-err');
  errEl.hidden = true;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
      reader.readAsDataURL(file);
    });
    await api(`/api/parts/${partId}/photos`, {
      method: 'POST',
      body: JSON.stringify({ content_type: file.type, data: dataUrl.split(',')[1] }),
    });
    await refreshPartPhotos(partId);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

document.getElementById('part-photo-list').addEventListener('click', async (e) => {
  const photoId = e.target.dataset.photoDelete;
  if (!photoId) return;
  const partId = document.getElementById('part-photo-box').dataset.partId;
  const ok = await confirmDialog({
    title: '写真の削除',
    message: 'この写真を削除します。よろしいですか？',
    okLabel: '削除する',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/parts/${partId}/photos/${photoId}`, { method: 'DELETE' });
    await refreshPartPhotos(partId);
  } catch (err) {
    const errEl = document.getElementById('part-err');
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

document.getElementById('form-part').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('part-id').value;
  const maker = presetMaker === 'その他'
    ? document.getElementById('part-maker-other').value.trim()
    : presetMaker;
  const payload = {
    category: document.getElementById('part-category').value.trim(),
    name: document.getElementById('part-name').value.trim(),
    maker,
    spec: document.getElementById('part-spec').value.trim(),
    serial_number: document.getElementById('part-serial').value.trim(),
    status: document.getElementById('part-status').value,
    purchase_date: document.getElementById('part-purchase-date').value || null,
    warranty_until: document.getElementById('part-warranty').value || null,
    notes: document.getElementById('part-notes').value.trim(),
  };
  try {
    if (id) {
      await api(`/api/parts/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/parts', { method: 'POST', body: JSON.stringify(payload) });
    }
    dlgPart.close();
    await reloadParts();
  } catch (err) {
    const el = document.getElementById('part-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

/* ---- CSVで書き出し ---- */
const STATUS_TEXT = { normal: '正常', broken: '故障', retired: '廃棄' };

function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

document.getElementById('btn-export-csv').addEventListener('click', () => {
  if (!partsCache.length) {
    alert('書き出すパーツがありません');
    return;
  }
  const header = ['category', 'name', 'maker', 'spec', 'serial_number', 'status', 'purchase_date', 'warranty_until', 'notes', 'assigned_server', 'registered_at'];
  const lines = [header.join(',')];
  sortedParts().forEach((p) => {
    lines.push([
      p.category, p.name, p.maker, p.spec, p.serial_number,
      STATUS_TEXT[p.status] || p.status,
      p.purchase_date || '', p.warranty_until || '', p.notes,
      p.current_server_name || '',
      p.created_at ? p.created_at.slice(0, 10) : '',
    ].map(csvCell).join(','));
  });
  // ExcelがUTF-8と判別できるようBOMを付ける（取り込み側はBOMを無視する）
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `parts_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

/* ---- CSV一括登録ダイアログ ---- */
const dlgBulkImport = document.getElementById('dlg-bulk-import');
const HEADER_ALIASES = {
  category: ['category', 'カテゴリ'],
  name: ['name', '名称', '型番', '品名'],
  maker: ['maker', 'メーカー', 'ブランド'],
  spec: ['spec', 'スペック', '仕様'],
  serial_number: ['serial_number', 'serial', 'シリアル番号', 'シリアル'],
  status: ['status', 'ステータス', '状態'],
  purchase_date: ['purchase_date', '購入日'],
  warranty_until: ['warranty_until', '保証期限'],
  notes: ['notes', '備考', 'メモ'],
};
let bulkParsedRows = [];
let bulkDupTargets = [];
let bulkDupChoices = [];

document.getElementById('btn-bulk-import').addEventListener('click', () => {
  document.getElementById('bulk-csv-text').value = '';
  document.getElementById('bulk-file-input').value = '';
  document.getElementById('bulk-preview-wrap').hidden = true;
  document.getElementById('bulk-err').hidden = true;
  document.getElementById('bulk-result').hidden = true;
  document.getElementById('btn-bulk-submit').disabled = true;
  document.getElementById('bulk-dup-bar').hidden = true;
  document.getElementById('bulk-dup-all').value = '';
  bulkParsedRows = [];
  bulkDupTargets = [];
  bulkDupChoices = [];
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

function parseCSV(rawText) {
  // Excel等が付けるBOMは先頭列名に混ざるので取り除く
  const text = rawText.charCodeAt(0) === 0xFEFF ? rawText.slice(1) : rawText;
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

// 既に登録済みのパーツと突き合わせる。シリアル番号があればそれを優先し、
// 無ければカテゴリ・名称・スペックで判定する。同一内容が複数あっても
// 1件ずつ消し込むので、同じメモリ2枚が1件に集約されることはない。
function matchExistingParts(rows, existingParts) {
  const pool = existingParts.map((part) => ({ part, used: false }));
  return rows.map((r) => {
    let hit = null;
    if (r.serial_number) {
      hit = pool.find((e) => !e.used && e.part.category === r.category && e.part.serial_number === r.serial_number);
    }
    if (!hit) {
      hit = pool.find((e) => !e.used
        && e.part.category === r.category
        && e.part.name === r.name
        && (e.part.spec || '') === (r.spec || ''));
    }
    if (!hit) return null;
    hit.used = true;
    return hit.part;
  });
}

function rowError(r) {
  const validStatuses = ['正常', '故障', '廃棄', 'normal', 'broken', 'retired', ''];
  if (!r.category) return 'カテゴリが空です';
  if (!r.name) return '名称が空です';
  if (!validStatuses.includes(r.status)) return `不正なステータス: ${r.status}`;
  return '';
}

function renderBulkPreview() {
  const tbody = document.getElementById('bulk-preview-tbody');
  let validCount = 0;
  let dupCount = 0;

  tbody.innerHTML = bulkParsedRows.map((r, i) => {
    const error = rowError(r);
    const dup = bulkDupTargets[i];
    if (!error) validCount++;
    if (dup) dupCount++;
    const dupCell = dup
      ? `<select class="dup-select" data-dup-row="${i}">
           <option value="skip"${bulkDupChoices[i] === 'skip' ? ' selected' : ''}>登録済みを残す</option>
           <option value="overwrite"${bulkDupChoices[i] === 'overwrite' ? ' selected' : ''}>CSVで上書き</option>
           <option value="both"${bulkDupChoices[i] === 'both' ? ' selected' : ''}>両方登録</option>
         </select>`
      : '-';
    const judge = error
      ? `<span class="row-error">${escapeHtml(error)}</span>`
      : (dup ? `<span class="row-dup">重複</span>` : '<span class="row-ok">新規</span>');
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.category)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.maker)}</td>
      <td>${escapeHtml(r.spec)}</td>
      <td>${escapeHtml(r.serial_number)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${judge}</td>
      <td>${dupCell}</td>
    </tr>`;
  }).join('');

  document.getElementById('bulk-preview-count').textContent =
    `${bulkParsedRows.length}件中 ${validCount}件が登録可能` + (dupCount ? ` / うち${dupCount}件が登録済みと重複` : '');
  const dupBar = document.getElementById('bulk-dup-bar');
  dupBar.hidden = dupCount === 0;
  document.getElementById('bulk-dup-summary').textContent =
    `${dupCount}件が既に登録済みのパーツと一致しました。行ごとに扱いを選べます。`;
  document.getElementById('bulk-preview-wrap').hidden = false;
  document.getElementById('btn-bulk-submit').disabled = validCount === 0;
}

document.getElementById('btn-bulk-preview').addEventListener('click', async () => {
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
    maker: headerMap.maker !== undefined ? (cols[headerMap.maker] || '').trim() : '',
    spec: headerMap.spec !== undefined ? (cols[headerMap.spec] || '').trim() : '',
    serial_number: headerMap.serial_number !== undefined ? (cols[headerMap.serial_number] || '').trim() : '',
    status: headerMap.status !== undefined ? (cols[headerMap.status] || '').trim() : '',
    purchase_date: headerMap.purchase_date !== undefined ? (cols[headerMap.purchase_date] || '').trim() : '',
    warranty_until: headerMap.warranty_until !== undefined ? (cols[headerMap.warranty_until] || '').trim() : '',
    notes: headerMap.notes !== undefined ? (cols[headerMap.notes] || '').trim() : '',
  }));

  try {
    const existingParts = await api('/api/parts');
    bulkDupTargets = matchExistingParts(bulkParsedRows, existingParts);
  } catch (err) {
    errEl.textContent = `登録済みパーツの取得に失敗しました: ${err.message}`;
    errEl.hidden = false;
    return;
  }
  bulkDupChoices = bulkParsedRows.map(() => 'skip');
  document.getElementById('bulk-dup-all').value = '';
  renderBulkPreview();
});

document.getElementById('bulk-preview-tbody').addEventListener('change', (e) => {
  const row = e.target.dataset.dupRow;
  if (row === undefined) return;
  bulkDupChoices[Number(row)] = e.target.value;
});

document.getElementById('bulk-dup-all').addEventListener('change', (e) => {
  if (!e.target.value) return;
  bulkDupChoices = bulkDupChoices.map((_, i) => (bulkDupTargets[i] ? e.target.value : 'skip'));
  renderBulkPreview();
});

document.getElementById('btn-bulk-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('bulk-err');
  errEl.hidden = true;

  const payload = [];
  let skipped = 0;
  bulkParsedRows.forEach((r, i) => {
    if (rowError(r)) { skipped++; return; }
    const dup = bulkDupTargets[i];
    if (!dup) { payload.push(r); return; }
    const choice = bulkDupChoices[i];
    if (choice === 'skip') { skipped++; return; }
    payload.push(choice === 'overwrite' ? { ...r, update_id: dup.id } : r);
  });

  if (!payload.length) {
    errEl.textContent = '反映する行がありません（すべてスキップまたはエラーです）';
    errEl.hidden = false;
    return;
  }

  try {
    const res = await api('/api/parts/bulk', { method: 'POST', body: JSON.stringify({ parts: payload }) });
    const resultEl = document.getElementById('bulk-result');
    const parts = [`${res.created.length}件を新規登録`];
    if (res.updated.length) parts.push(`${res.updated.length}件を上書き`);
    if (skipped) parts.push(`${skipped}件をスキップ`);
    let msg = `${parts.join(' / ')}しました。`;
    if (res.errors.length) {
      msg += ` (${res.errors.length}件エラー: ${res.errors.map((e) => `${e.row}行目 - ${e.error}`).join(' / ')})`;
    }
    resultEl.textContent = msg;
    resultEl.hidden = false;
    document.getElementById('btn-bulk-submit').disabled = true;
    await reloadParts();
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
      ${iconBtn(ICON.view, '構成を見る', `data-open-server="${s.id}"`)}
      ${(currentUser && currentUser.role === 'admin' && s.ssh && s.ssh.configured)
        ? iconBtn(ICON.terminal, 'SSHで構成を取得', `data-ssh-fetch="${s.id}" data-ssh-fetch-name="${escapeHtml(s.name)}"`)
        : ''}
      ${iconBtn(ICON.edit, '編集', `data-edit-server="${s.id}"`)}
      ${iconBtn(ICON.trash, '削除', `data-delete-server="${s.id}"`, true)}
    </div></td>
  </tr>`).join('');
}

document.getElementById('servers-search').addEventListener('input', debounce(loadServers, 250));

document.getElementById('servers-tbody').addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.openServer) return openServerDetail(Number(t.dataset.openServer));
  if (t.dataset.editServer) return openServerDialog(Number(t.dataset.editServer));
  if (t.dataset.deleteServer) return deleteServer(Number(t.dataset.deleteServer));
  if (t.dataset.sshFetch) return runSshFetch(Number(t.dataset.sshFetch), t.dataset.sshFetchName, t);
});

// SSHで構成を取得し、成功したら構成同期タブに差分を表示する
async function runSshFetch(serverId, serverName, triggerBtn) {
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    const res = await api(`/api/servers/${serverId}/ssh-fetch`, { method: 'POST' });
    const s = res.summary;
    await Promise.all([loadSyncReports(), loadDashboard()]);
    const goToSync = confirm(
      `「${serverName}」の構成を取得しました。\n`
      + `一致: ${s.matched}件 / 在庫から割り当て候補: ${s.to_assign}件 / 未登録: ${s.unregistered}件 / 取り外し候補: ${s.to_remove}件\n\n`
      + `構成同期タブを開いて内容を確認しますか？`
    );
    if (goToSync) document.querySelector('.tab-btn[data-tab="sync"]').click();
  } catch (err) {
    alert(`SSH取得に失敗しました: ${err.message}`);
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

async function deleteServer(id) {
  const server = serversCache.find((s) => s.id === id);
  const ok = await confirmDialog({
    title: 'サーバーの削除',
    message: `「${server ? server.name : ''}」を削除します。\nこの操作は取り消せません。よろしいですか？`,
    okLabel: '削除する',
    danger: true,
  });
  if (!ok) return;
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
document.getElementById('btn-server-cancel').addEventListener('click', () => closeDialog(dlgServer));

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
  renderSshDetails(id ? serversCache.find((x) => x.id === id) : null);
  dlgServer.showModal();
}

/* ---- SSH高度な設定 ---- */
function renderSshDetails(server) {
  const details = document.getElementById('server-ssh-details');
  details.hidden = !currentUser || currentUser.role !== 'admin';
  details.open = false;
  document.getElementById('ssh-err').hidden = true;
  document.getElementById('ssh-status').hidden = true;

  const hasServer = !!server;
  document.getElementById('ssh-save-hint').hidden = hasServer;
  document.getElementById('ssh-fields-wrap').hidden = !hasServer;
  if (!hasServer) return;

  const ssh = server.ssh || { configured: false };
  document.getElementById('ssh-host').value = ssh.host || '';
  document.getElementById('ssh-port').value = ssh.port || 22;
  document.getElementById('ssh-username').value = ssh.username || '';
  document.getElementById('ssh-os-hint').value = ssh.os_hint || 'linux';
  document.getElementById('ssh-auth-method').value = ssh.auth_method || 'password';
  document.getElementById('ssh-password').value = '';
  document.getElementById('ssh-private-key').value = '';
  document.getElementById('ssh-passphrase').value = '';
  document.getElementById('ssh-use-sudo').checked = ssh.use_sudo !== false;
  syncSshAuthFields();
  document.getElementById('btn-ssh-clear').hidden = !ssh.configured;
  document.getElementById('btn-ssh-fetch').hidden = !ssh.configured;

  const passwordInput = document.getElementById('ssh-password');
  const keyInput = document.getElementById('ssh-private-key');
  passwordInput.placeholder = ssh.configured ? '設定済み（変更する場合のみ入力）' : 'パスワードを入力';
  keyInput.placeholder = ssh.configured
    ? '設定済み（変更する場合のみ入力）'
    : '-----BEGIN OPENSSH PRIVATE KEY-----\n...';
}

function syncSshAuthFields() {
  const isKey = document.getElementById('ssh-auth-method').value === 'key';
  document.getElementById('ssh-password-label').hidden = isKey;
  document.getElementById('ssh-key-label').hidden = !isKey;
  document.getElementById('ssh-passphrase-label').hidden = !isKey;
  document.getElementById('ssh-sudo-field').hidden = document.getElementById('ssh-os-hint').value === 'windows';
}
document.getElementById('ssh-auth-method').addEventListener('change', syncSshAuthFields);
document.getElementById('ssh-os-hint').addEventListener('change', syncSshAuthFields);

document.getElementById('btn-ssh-save').addEventListener('click', async () => {
  const errEl = document.getElementById('ssh-err');
  const statusEl = document.getElementById('ssh-status');
  errEl.hidden = true;
  statusEl.hidden = true;
  const id = document.getElementById('server-id').value;
  if (!id) return;

  const payload = {
    host: document.getElementById('ssh-host').value.trim(),
    port: Number(document.getElementById('ssh-port').value) || 22,
    username: document.getElementById('ssh-username').value.trim(),
    auth_method: document.getElementById('ssh-auth-method').value,
    os_hint: document.getElementById('ssh-os-hint').value,
    use_sudo: document.getElementById('ssh-use-sudo').checked,
  };
  const password = document.getElementById('ssh-password').value;
  const privateKey = document.getElementById('ssh-private-key').value;
  const passphrase = document.getElementById('ssh-passphrase').value;
  if (password) payload.password = password;
  if (privateKey) payload.private_key = privateKey;
  if (passphrase) payload.passphrase = passphrase;

  try {
    const updated = await api(`/api/servers/${id}/ssh`, { method: 'PUT', body: JSON.stringify(payload) });
    const idx = serversCache.findIndex((s) => s.id === Number(id));
    if (idx !== -1) serversCache[idx] = updated;
    renderSshDetails(updated);
    statusEl.textContent = 'SSH設定を保存しました。';
    statusEl.className = 'ssh-status ok';
    statusEl.hidden = false;
    renderServersTable();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

document.getElementById('btn-ssh-clear').addEventListener('click', async () => {
  const id = document.getElementById('server-id').value;
  if (!id) return;
  const ok = await confirmDialog({
    title: 'SSH設定の削除',
    message: '保存されているSSH接続情報を削除します。よろしいですか？',
    okLabel: '削除する',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/servers/${id}/ssh`, { method: 'DELETE' });
    await loadServers();
    renderSshDetails(serversCache.find((s) => s.id === Number(id)));
  } catch (err) {
    const errEl = document.getElementById('ssh-err');
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

document.getElementById('btn-ssh-fetch').addEventListener('click', async () => {
  const id = Number(document.getElementById('server-id').value);
  if (!id) return;
  const statusEl = document.getElementById('ssh-status');
  const errEl = document.getElementById('ssh-err');
  const btn = document.getElementById('btn-ssh-fetch');
  errEl.hidden = true;
  statusEl.className = 'ssh-status';
  statusEl.textContent = '接続して取得しています…（Windowsは特に時間がかかることがあります）';
  statusEl.hidden = false;
  btn.disabled = true;
  try {
    const res = await api(`/api/servers/${id}/ssh-fetch`, { method: 'POST' });
    const s = res.summary;
    statusEl.textContent = `取得しました。一致${s.matched} / 割り当て候補${s.to_assign} / 未登録${s.unregistered} / 取り外し候補${s.to_remove}`;
    statusEl.className = 'ssh-status ok';
    await Promise.all([loadSyncReports(), loadDashboard()]);
  } catch (err) {
    statusEl.hidden = true;
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

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
    let created = null;
    if (id) {
      await api(`/api/servers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      created = await api('/api/servers', { method: 'POST', body: JSON.stringify(payload) });
    }
    // closeイベントで選択が巻き戻らないよう、閉じる前にフラグを降ろす
    const fromSyncTab = syncAwaitingNewServer;
    syncAwaitingNewServer = false;
    dlgServer.close();
    await loadServers();
    if (fromSyncTab && created) {
      await loadCommandBuilder();
      const select = document.getElementById('cmd-server');
      select.value = created.name;
      syncServerPrevValue = created.name;
      renderCommand();
    }
  } catch (err) {
    const el = document.getElementById('server-err');
    el.textContent = err.message;
    el.hidden = false;
  }
});

/* ---- サーバー詳細（構成）ダイアログ ---- */
const dlgServerDetail = document.getElementById('dlg-server-detail');
document.getElementById('btn-server-detail-close').addEventListener('click', () => closeDialog(dlgServerDetail));
let currentDetailServerId = null;
registerAfterClose(dlgServerDetail, () => { currentDetailServerId = null; });

// 同じカテゴリ・名称・スペックのパーツ（メモリ等）を1行にまとめる
function groupConfig(config) {
  const groups = [];
  const byKey = new Map();
  config.forEach((c) => {
    const key = `${c.category}|${c.name}|${c.spec}`;
    if (!byKey.has(key)) {
      const group = { items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).items.push(c);
  });
  return groups;
}

function configRowHtml(c, groupId) {
  const isDetail = !!groupId;
  return `<tr class="${isDetail ? 'group-detail' : ''}"${isDetail ? ` data-group="${groupId}" hidden` : ''}>
    <td class="cell-category">${isDetail ? '' : escapeHtml(categoryLabel(c.category))}</td>
    <td>${escapeHtml(c.name)}</td>
    <td>${escapeHtml(c.spec) || '-'}</td>
    <td>${escapeHtml(c.serial_number) || '-'}</td>
    <td>${fmtDate(c.installed_at)}</td>
    <td><div class="row-actions">
      ${iconBtn(ICON.unassign, '取り外す', `data-detail-remove="${c.assignment_id}"`)}
      ${iconBtn(ICON.move, '別サーバーへ移動', `data-detail-move="${c.assignment_id}" data-detail-move-name="${escapeHtml(c.name)}"`)}
    </div></td>
  </tr>`;
}

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
    cfgBody.innerHTML = groupConfig(s.current_config).map((g, gi) => {
      if (g.items.length === 1) return configRowHtml(g.items[0], null);
      const groupId = `g${gi}`;
      const head = g.items[0];
      const summary = `<tr class="group-row" data-group-toggle="${groupId}">
        <td class="cell-category"><span class="group-toggle-icon">▶</span> ${escapeHtml(categoryLabel(head.category))}</td>
        <td>${escapeHtml(head.name)}<span class="group-count">×${g.items.length}</span></td>
        <td>${escapeHtml(head.spec) || '-'}</td>
        <td colspan="3">クリックで内訳を表示</td>
      </tr>`;
      return summary + g.items.map((item) => configRowHtml(item, groupId)).join('');
    }).join('');
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
  const groupRow = t.closest('[data-group-toggle]');
  if (groupRow) {
    const expanded = groupRow.classList.toggle('expanded');
    document
      .querySelectorAll(`#server-detail-config-tbody tr[data-group="${groupRow.dataset.groupToggle}"]`)
      .forEach((row) => { row.hidden = !expanded; });
  }
});

async function refreshServerDetail() {
  if (currentDetailServerId) await openServerDetail(currentDetailServerId);
}

document.getElementById('btn-server-detail-assign').addEventListener('click', () => {
  openAssignDialog(currentDetailServerId);
});

/* ================= 割り当てダイアログ（サーバー詳細から在庫パーツを選ぶ） ================= */
const dlgAssign = document.getElementById('dlg-assign');
document.getElementById('btn-assign-cancel').addEventListener('click', () => dlgAssign.close());

async function openAssignDialog(serverId) {
  document.getElementById('assign-err').hidden = true;
  document.getElementById('form-assign').reset();
  document.getElementById('assign-date').value = todayInputValue();
  document.getElementById('assign-server-id').value = serverId;

  const server = serversCache.find((s) => s.id === serverId);
  document.getElementById('assign-dlg-title').textContent = `パーツを割り当てる: ${server ? server.name : ''}`;

  const partSelect = document.getElementById('assign-part-select');
  const stockParts = await api('/api/parts?assignment_state=in_stock&status=normal');
  if (!stockParts.length) {
    partSelect.innerHTML = '<option value="">(割り当て可能な在庫パーツがありません)</option>';
  } else {
    partSelect.innerHTML = stockParts
      .map((p) => `<option value="${p.id}">${escapeHtml(p.category)} / ${escapeHtml(p.name)}${p.serial_number ? ' (' + escapeHtml(p.serial_number) + ')' : ''}</option>`)
      .join('');
  }
  dlgAssign.showModal();
}

document.getElementById('form-assign').addEventListener('submit', async (e) => {
  e.preventDefault();
  const part_id = document.getElementById('assign-part-select').value;
  const server_id = document.getElementById('assign-server-id').value;
  if (!part_id || !server_id) {
    const el = document.getElementById('assign-err');
    el.textContent = '割り当てるパーツを選択してください';
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

/* ================= 認証 ================= */
let currentUser = null;
let authMode = 'login'; // 'login' | 'setup'

function showAuthScreen(state) {
  authMode = state.setup_required ? 'setup' : 'login';
  currentUser = null;
  document.getElementById('app-shell').hidden = true;
  document.getElementById('auth-screen').hidden = false;
  document.getElementById('auth-err').hidden = true;
  document.getElementById('auth-lead').textContent = authMode === 'setup'
    ? '最初の管理者アカウントを作成してください。'
    : 'ログインしてください。';
  document.getElementById('btn-auth-submit').textContent = authMode === 'setup' ? '作成してはじめる' : 'ログイン';
  document.getElementById('auth-password2-label').hidden = authMode !== 'setup';
  document.getElementById('auth-password').autocomplete = authMode === 'setup' ? 'new-password' : 'current-password';
  document.getElementById('form-auth').reset();
}

async function showApp(user) {
  currentUser = user;
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('app-shell').hidden = false;
  document.getElementById('current-user').textContent = `${user.username}（${user.role === 'admin' ? '管理者' : '一般'}）`;
  document.querySelectorAll('.admin-only').forEach((el) => { el.hidden = user.role !== 'admin'; });
  await refreshAll();
  if (user.role === 'admin') await Promise.all([loadUsers(), loadTokens()]);
}

document.getElementById('form-auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('auth-err');
  errEl.hidden = true;
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  if (authMode === 'setup' && password !== document.getElementById('auth-password2').value) {
    errEl.textContent = 'パスワードが一致しません';
    errEl.hidden = false;
    return;
  }
  try {
    const res = await api(`/api/auth/${authMode}`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    await showApp(res.user);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  showAuthScreen({ setup_required: false });
});

/* ---- パスワード変更 ---- */
document.getElementById('form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('pw-err');
  const okEl = document.getElementById('pw-ok');
  errEl.hidden = true;
  okEl.hidden = true;
  try {
    await api('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: document.getElementById('pw-current').value,
        new_password: document.getElementById('pw-new').value,
      }),
    });
    document.getElementById('form-password').reset();
    okEl.hidden = false;
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

/* ---- ユーザー管理 ---- */
async function loadUsers() {
  const users = await api('/api/auth/users');
  document.getElementById('users-tbody').innerHTML = users.map((u) => `<tr>
    <td>${escapeHtml(u.username)}</td>
    <td>${u.role === 'admin' ? '管理者' : '一般'}</td>
    <td>${fmtDate(u.created_at)}</td>
    <td>${u.last_login_at ? fmtDate(u.last_login_at) : '-'}</td>
    <td>${u.id === currentUser.id ? '<span class="unit-label">自分</span>' : iconBtn(ICON.trash, '削除', `data-delete-user="${u.id}" data-user-name="${escapeHtml(u.username)}"`, true)}</td>
  </tr>`).join('');
}

document.getElementById('form-new-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('user-err');
  errEl.hidden = true;
  try {
    await api('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('new-user-name').value.trim(),
        password: document.getElementById('new-user-password').value,
        role: document.getElementById('new-user-role').value,
      }),
    });
    document.getElementById('form-new-user').reset();
    await loadUsers();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

document.getElementById('users-tbody').addEventListener('click', async (e) => {
  const id = e.target.dataset.deleteUser;
  if (!id) return;
  const ok = await confirmDialog({
    title: 'ユーザーの削除',
    message: `ユーザー「${e.target.dataset.userName}」を削除します。よろしいですか？`,
    okLabel: '削除する',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/auth/users/${id}`, { method: 'DELETE' });
    await loadUsers();
  } catch (err) {
    const errEl = document.getElementById('user-err');
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

/* ---- APIトークン ---- */
async function loadTokens() {
  const tokens = await api('/api/auth/tokens');
  document.getElementById('tokens-tbody').innerHTML = tokens.map((t) => `<tr>
    <td>${escapeHtml(t.name)}</td>
    <td>${fmtDate(t.created_at)}</td>
    <td>${iconBtn(ICON.trash, '失効させる', `data-delete-token="${t.id}" data-token-name="${escapeHtml(t.name)}"`, true)}</td>
  </tr>`).join('');
}

document.getElementById('form-new-token').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('token-err');
  errEl.hidden = true;
  try {
    const res = await api('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: document.getElementById('new-token-name').value.trim() }),
    });
    const reveal = document.getElementById('token-reveal');
    reveal.textContent = `${res.name}: ${res.token} — この画面を離れると二度と表示されません。控えてください。`;
    reveal.hidden = false;
    document.getElementById('form-new-token').reset();
    await loadTokens();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

document.getElementById('tokens-tbody').addEventListener('click', async (e) => {
  const id = e.target.dataset.deleteToken;
  if (!id) return;
  const ok = await confirmDialog({
    title: 'APIトークンの失効',
    message: `トークン「${e.target.dataset.tokenName}」を失効させます。\nこのトークンを使っている処理は動かなくなります。よろしいですか？`,
    okLabel: '失効させる',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/auth/tokens/${id}`, { method: 'DELETE' });
    await loadTokens();
  } catch (err) {
    const errEl = document.getElementById('token-err');
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

/* ================= ダッシュボード ================= */

async function loadDashboard() {
  const data = await api('/api/dashboard');
  const s = data.summary;

  const cards = [
    { label: '総パーツ数', value: s.total, cls: '' },
    { label: '在庫', value: s.in_stock, cls: 'accent-stock' },
    { label: '使用中', value: s.assigned, cls: 'accent-assigned' },
    { label: '故障', value: s.broken, cls: 'accent-broken' },
    { label: '廃棄', value: s.retired, cls: '' },
    { label: 'サーバー', value: s.servers, cls: '' },
  ];
  if (s.pending_sync) cards.push({ label: '未処理の構成差分', value: s.pending_sync, cls: 'accent-sync' });
  if (s.warranty_alerts) cards.push({ label: '保証期限の注意', value: s.warranty_alerts, cls: 'accent-sync' });
  if (s.trashed) cards.push({ label: 'ゴミ箱', value: s.trashed, cls: '' });

  document.getElementById('stat-grid').innerHTML = cards.map((c) => `<div class="stat-card ${c.cls}">
    <div class="stat-label">${c.label}</div>
    <div class="stat-value">${c.value}</div>
  </div>`).join('');

  const catWrap = document.getElementById('dash-categories');
  document.getElementById('dash-categories-empty').hidden = data.categories.length > 0;
  const legend = `<div class="cat-legend">
    <span><i style="background:#4ade80"></i>使用中</span>
    <span><i style="background:#818cf8"></i>在庫</span>
    <span><i style="background:#f87171"></i>故障</span>
  </div>`;
  catWrap.innerHTML = data.categories.length ? legend + data.categories.map((c) => {
    const pct = (n) => (c.total ? (n / c.total) * 100 : 0);
    return `<div class="cat-row">
      <div class="cat-row-head">
        <span>${escapeHtml(categoryLabel(c.category))}</span>
        <span class="cat-counts">計${c.total} ／ 使用中${c.assigned} ・ 在庫${c.in_stock}${c.broken ? ` ・ 故障${c.broken}` : ''}</span>
      </div>
      <div class="cat-bar">
        <span class="seg-assigned" style="width:${pct(c.assigned)}%"></span>
        <span class="seg-stock" style="width:${pct(c.in_stock)}%"></span>
        <span class="seg-broken" style="width:${pct(c.broken)}%"></span>
      </div>
    </div>`;
  }).join('') : '';

  document.getElementById('dash-servers-empty').hidden = data.servers.length > 0;
  document.getElementById('dash-servers-tbody').innerHTML = data.servers.map((s2) => `<tr>
    <td><button class="server-link" data-open-server="${s2.id}">${escapeHtml(s2.name)}</button></td>
    <td>${escapeHtml(s2.location) || '-'}</td>
    <td>${escapeHtml(s2.status) || '-'}</td>
    <td>${s2.parts}</td>
  </tr>`).join('');

  const warranty = data.warranty || [];
  document.getElementById('dash-warranty-section').hidden = warranty.length === 0;
  document.getElementById('dash-warranty-tbody').innerHTML = warranty.map((w) => `<tr>
    <td class="cell-category">${escapeHtml(categoryLabel(w.category))}</td>
    <td>${w.maker ? `<span class="maker-tag">${escapeHtml(w.maker)}</span>` : ''}${escapeHtml(w.name)}</td>
    <td>${fmtDate(w.warranty_until)}</td>
    <td class="${w.expired ? 'warranty-expired' : 'warranty-soon'}">${w.expired ? '期限切れ' : 'まもなく期限'}</td>
  </tr>`).join('');

  document.getElementById('dash-recent-empty').hidden = data.recent.length > 0;
  document.getElementById('dash-recent-tbody').innerHTML = data.recent.map((l) => `<tr>
    <td>${fmtDateTime(l.at)}</td>
    <td>${escapeHtml(l.user)}</td>
    <td>${escapeHtml(ACTION_LABEL[l.action] || l.action)}</td>
    <td>${escapeHtml(l.target_name) || '-'}</td>
    <td>${escapeHtml(l.detail) || '-'}</td>
  </tr>`).join('');
}

document.getElementById('dash-servers-tbody').addEventListener('click', (e) => {
  if (e.target.dataset.openServer) openServerDetail(Number(e.target.dataset.openServer));
});

/* ================= 構成同期 ================= */
let syncReports = [];

/* ---- 実行コマンドの生成 ---- */
// スクリプトの取得元。リポジトリ名を変えたらここも変える。
const SCRIPT_BASE_URL = 'https://raw.githubusercontent.com/mesamaru/server-parts-inventory/main/scripts';
const TOKEN_PLACEHOLDER = '<APIトークン>';
// 発行直後のトークンだけは値が分かるので、この画面を開いている間は覚えておく
const issuedTokens = new Map();

async function loadCommandBuilder() {
  const serverSelect = document.getElementById('cmd-server');
  const keepServer = serverSelect.value;
  serverSelect.innerHTML = serversCache.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('')
    + '<option value="__new_server__">＋ 新しいサーバーを登録する</option>';
  if (keepServer && keepServer !== '__new_server__') serverSelect.value = keepServer;

  const urlInput = document.getElementById('cmd-url');
  if (!urlInput.value) urlInput.value = location.origin;

  await reloadTokenOptions();
  renderCommand();
}

// トークン一覧を読み直す。発行・失効の直後や、はじめて構成同期タブを開いたときに呼ぶ。
async function reloadTokenOptions() {
  const tokenSelect = document.getElementById('cmd-token');
  const keepToken = tokenSelect.value;
  const errEl = document.getElementById('cmd-token-err');
  errEl.hidden = true;

  // トークンの発行も一覧取得も管理者専用なので、一般ユーザーには選択肢を出さない
  if (!currentUser || currentUser.role !== 'admin') {
    tokenSelect.innerHTML = '<option value="">(管理者に発行してもらってください)</option>';
    tokenSelect.disabled = true;
    return;
  }
  tokenSelect.disabled = false;
  let options = '<option value="__new__">＋ 新しいトークンを発行する</option>';
  try {
    const tokens = await api('/api/auth/tokens');
    options += tokens.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  } catch (err) {
    errEl.textContent = `トークン一覧を取得できませんでした: ${err.message}`;
    errEl.hidden = false;
  }
  tokenSelect.innerHTML = options;
  if (keepToken && [...tokenSelect.options].some((o) => o.value === keepToken)) {
    tokenSelect.value = keepToken;
  }
}

function renderCommand() {
  const os = document.getElementById('cmd-os').value;
  const serverValue = document.getElementById('cmd-server').value;
  const server = (!serverValue || serverValue === '__new_server__') ? '<サーバー名>' : serverValue;
  const url = (document.getElementById('cmd-url').value || location.origin).replace(/\/+$/, '');
  const tokenId = document.getElementById('cmd-token').value;
  const token = issuedTokens.get(tokenId) || TOKEN_PLACEHOLDER;
  const useSudo = document.getElementById('cmd-sudo').checked;

  document.getElementById('cmd-sudo-field').hidden = os === 'windows';

  const note = document.getElementById('cmd-token-note');
  if (tokenId === '__new__') {
    note.textContent = 'このプルダウンで選ぶと、その場でトークンを発行して値を埋め込みます。';
  } else if (!tokenId) {
    note.textContent = 'APIトークンの発行は管理者のみ行えます。発行済みの値を管理者から受け取って置き換えてください。';
  } else if (token === TOKEN_PLACEHOLDER) {
    note.textContent = 'トークンの値は発行時にしか表示されないため、ここでは埋め込めません。控えがなければ新規発行を選んでください。';
  } else {
    note.textContent = '発行したトークンを埋め込んでいます。この画面を離れると再表示できません。';
  }

  document.getElementById('cmd-text').textContent = os === 'windows'
    ? `curl.exe -O ${SCRIPT_BASE_URL}/hw_to_csv.ps1\n`
      + `powershell -ExecutionPolicy Bypass -File .\\hw_to_csv.ps1 -Push -Url ${url} -Token ${token} -Server ${server}`
    : `curl -O ${SCRIPT_BASE_URL}/hw_to_csv.py\n`
      + `${useSudo ? 'sudo ' : ''}python3 hw_to_csv.py --push --url ${url} --token ${token} --server ${server}`;
}

['cmd-os', 'cmd-server', 'cmd-url', 'cmd-sudo'].forEach((id) => {
  document.getElementById(id).addEventListener('input', renderCommand);
  document.getElementById(id).addEventListener('change', renderCommand);
});

// トークンを選んだ時点で発行する（コピー操作に副作用を持たせない）
document.getElementById('cmd-token').addEventListener('change', async (e) => {
  if (e.target.value !== '__new__') {
    renderCommand();
    return;
  }
  await issueTokenForSync();
});

async function issueTokenForSync() {
  const tokenSelect = document.getElementById('cmd-token');
  const errEl = document.getElementById('cmd-token-err');
  errEl.hidden = true;
  const server = document.getElementById('cmd-server').value;
  const label = (server && server !== '__new_server__') ? server : 'script';

  tokenSelect.disabled = true;
  renderCommand();
  try {
    const res = await api('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: `${label} (構成同期)` }),
    });
    issuedTokens.set(String(res.id), res.token);
    const option = document.createElement('option');
    option.value = String(res.id);
    option.textContent = res.name;
    tokenSelect.insertBefore(option, tokenSelect.firstChild.nextSibling);
    tokenSelect.value = String(res.id);
    if (currentUser.role === 'admin') await loadTokens();
  } catch (err) {
    errEl.textContent = `トークンを発行できませんでした: ${err.message}`;
    errEl.hidden = false;
    tokenSelect.value = '__new__';
  } finally {
    tokenSelect.disabled = false;
    renderCommand();
  }
}

// 対象サーバーの選択肢からそのままサーバーを登録できるようにする
let syncServerPrevValue = '';
let syncAwaitingNewServer = false;

document.getElementById('cmd-server').addEventListener('change', (e) => {
  if (e.target.value !== '__new_server__') {
    syncServerPrevValue = e.target.value;
    return;
  }
  syncAwaitingNewServer = true;
  openServerDialog(null);
});

// 登録せずに閉じた場合は選択を元に戻す
registerAfterClose(document.getElementById('dlg-server'), () => {
  if (!syncAwaitingNewServer) return;
  syncAwaitingNewServer = false;
  const select = document.getElementById('cmd-server');
  select.value = syncServerPrevValue || (select.options[0] ? select.options[0].value : '');
  renderCommand();
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // HTTPS以外ではclipboard APIが使えないので選択方式にフォールバックする
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

document.getElementById('btn-cmd-copy').addEventListener('click', async () => {
  const btn = document.getElementById('btn-cmd-copy');
  const ok = await copyText(document.getElementById('cmd-text').textContent);
  btn.textContent = ok ? 'コピーしました' : 'コピーできません（手動で選択してください）';
  setTimeout(() => { btn.textContent = 'コピー'; }, 2000);
});

function partLabel(p) {
  const bits = [p.spec, p.serial_number && `S/N: ${p.serial_number}`, p.notes].filter(Boolean);
  return `<strong>${escapeHtml(categoryLabel(p.category))}</strong> ${p.maker ? `<span class="maker-tag">${escapeHtml(p.maker)}</span>` : ''}${escapeHtml(p.name)}`
    + (bits.length ? `<br /><span class="sync-meta">${escapeHtml(bits.join(' / '))}</span>` : '');
}

function syncGroupHtml({ cls, title, items, renderItem }) {
  if (!items.length) return '';
  return `<div class="sync-group ${cls}">
    <h4>${title}（${items.length}件）</h4>
    ${items.map(renderItem).join('')}
  </div>`;
}

function renderSyncReports() {
  const wrap = document.getElementById('sync-reports');
  document.getElementById('sync-empty').hidden = syncReports.length > 0;
  const badge = document.getElementById('sync-badge');
  badge.textContent = syncReports.length;
  badge.hidden = syncReports.length === 0;

  wrap.innerHTML = syncReports.map((report) => {
    const d = report.diff;
    return `<div class="sync-report" data-report="${report.id}">
      <div class="sync-report-head">
        <h3>${escapeHtml(report.server_name)}</h3>
        <span class="sync-meta">${fmtDateTime(report.created_at)} 受信${report.host_info ? ` / ${escapeHtml(report.host_info)}` : ''}</span>
      </div>

      ${syncGroupHtml({
        cls: 'remove',
        title: '実機に見つからない（取り外す）',
        items: d.to_remove,
        renderItem: (item) => `<label class="sync-item">
          <input type="checkbox" data-sync-remove="${item.assignment_id}" checked />
          <span>${partLabel(item)}</span>
        </label>`,
      })}

      ${syncGroupHtml({
        cls: 'assign',
        title: '在庫に一致するものがある（割り当てる）',
        items: d.to_assign,
        renderItem: (item) => `<label class="sync-item">
          <input type="checkbox" data-sync-assign="${item.part_id}" checked />
          <span>${partLabel(item.reported)}<br /><span class="sync-meta">→ 在庫の「${escapeHtml(item.name)}」を割り当て</span></span>
        </label>`,
      })}

      ${syncGroupHtml({
        cls: 'register',
        title: '未登録（内容を確認して登録）',
        items: d.unregistered,
        renderItem: (item, i) => `<label class="sync-item">
          <input type="checkbox" data-sync-register="${i}" />
          <span>${partLabel(item.reported)}</span>
        </label>`,
      })}

      ${syncGroupHtml({
        cls: 'matched',
        title: '台帳と一致（操作不要）',
        items: d.matched,
        renderItem: (item) => `<div class="sync-item"><span>${partLabel(item.reported)}</span></div>`,
      })}

      <div class="sync-actions">
        <button type="button" class="secondary" data-sync-dismiss="${report.id}">破棄</button>
        <button type="button" class="primary" data-sync-apply="${report.id}">選択した内容を反映</button>
      </div>
    </div>`;
  }).join('');
}

async function loadSyncReports() {
  syncReports = await api('/api/sync/reports');
  renderSyncReports();
}

document.getElementById('tab-sync').addEventListener('click', async (e) => {
  const t = e.target;
  const errEl = document.getElementById('sync-err');

  if (t.dataset.syncDismiss) {
    const ok = await confirmDialog({
      title: '差分の破棄',
      message: 'この構成レポートを破棄します。台帳は変更されません。よろしいですか？',
      okLabel: '破棄する',
    });
    if (!ok) return;
    try {
      await api(`/api/sync/reports/${t.dataset.syncDismiss}`, { method: 'DELETE' });
      await loadSyncReports();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
    return;
  }

  if (t.dataset.syncApply) {
    const id = Number(t.dataset.syncApply);
    const report = syncReports.find((r) => r.id === id);
    const card = t.closest('.sync-report');
    const checked = (selector) => [...card.querySelectorAll(selector)].filter((cb) => cb.checked);

    const remove_assignment_ids = checked('[data-sync-remove]').map((cb) => Number(cb.dataset.syncRemove));
    const assign_part_ids = checked('[data-sync-assign]').map((cb) => Number(cb.dataset.syncAssign));
    const register = checked('[data-sync-register]')
      .map((cb) => report.diff.unregistered[Number(cb.dataset.syncRegister)].reported);

    if (!remove_assignment_ids.length && !assign_part_ids.length && !register.length) {
      errEl.textContent = '反映する項目が選択されていません';
      errEl.hidden = false;
      return;
    }

    const ok = await confirmDialog({
      title: '構成の反映',
      message: `取り外し${remove_assignment_ids.length}件 / 割り当て${assign_part_ids.length}件 / 新規登録${register.length}件を反映します。よろしいですか？`,
      okLabel: '反映する',
    });
    if (!ok) return;

    errEl.hidden = true;
    try {
      const res = await api(`/api/sync/reports/${id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ remove_assignment_ids, assign_part_ids, register }),
      });
      if (res.errors.length) alert(`一部反映できませんでした:\n${res.errors.join('\n')}`);
      await Promise.all([loadSyncReports(), refreshAll()]);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  }
});

/* ================= 履歴・ゴミ箱 ================= */

const ACTION_LABEL = {
  'part.create': 'パーツ登録',
  'part.update': 'パーツ編集',
  'part.delete': 'パーツ削除',
  'part.restore': 'パーツ復元',
  'part.purge': 'パーツ完全削除',
  'part.bulk_import': 'CSV一括登録',
  'part.bulk_edit': 'パーツ一括編集',
  'part.bulk_delete': 'パーツ一括削除',
  'server.create': 'サーバー登録',
  'server.update': 'サーバー編集',
  'server.delete': 'サーバー削除',
  'server.restore': 'サーバー復元',
  'server.purge': 'サーバー完全削除',
  'assignment.assign': '割り当て',
  'assignment.bulk_assign': '一括割り当て',
  'assignment.remove': '取り外し',
  'assignment.bulk_remove': '一括取り外し',
  'assignment.move': 'サーバー間移動',
};

function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function loadTrash() {
  const trash = await api('/api/trash');
  const partsBody = document.getElementById('trash-parts-tbody');
  partsBody.innerHTML = trash.parts.map((p) => `<tr>
    <td class="cell-category">${escapeHtml(categoryLabel(p.category))}</td>
    <td>${p.maker ? `<span class="maker-tag">${escapeHtml(p.maker)}</span>` : ''}${escapeHtml(p.name)}</td>
    <td>${escapeHtml(p.spec) || '-'}</td>
    <td>${escapeHtml(p.serial_number) || '-'}</td>
    <td>${fmtDateTime(p.deleted_at)}</td>
    <td><div class="row-actions">
      <button type="button" class="link" data-restore="parts" data-restore-id="${p.id}" data-restore-name="${escapeHtml(p.name)}">復元</button>
      ${currentUser.role === 'admin' ? `<button type="button" class="link danger-link" data-purge="parts" data-purge-id="${p.id}" data-purge-name="${escapeHtml(p.name)}">完全削除</button>` : ''}
    </div></td>
  </tr>`).join('');
  document.getElementById('trash-parts-empty').hidden = trash.parts.length > 0;

  const serversBody = document.getElementById('trash-servers-tbody');
  serversBody.innerHTML = trash.servers.map((s) => `<tr>
    <td>${escapeHtml(s.name)}</td>
    <td>${escapeHtml(s.location) || '-'}</td>
    <td>${fmtDateTime(s.deleted_at)}</td>
    <td><div class="row-actions">
      <button type="button" class="link" data-restore="servers" data-restore-id="${s.id}" data-restore-name="${escapeHtml(s.name)}">復元</button>
      ${currentUser.role === 'admin' ? `<button type="button" class="link danger-link" data-purge="servers" data-purge-id="${s.id}" data-purge-name="${escapeHtml(s.name)}">完全削除</button>` : ''}
    </div></td>
  </tr>`).join('');
  document.getElementById('trash-servers-empty').hidden = trash.servers.length > 0;
}

async function loadAudit() {
  const logs = await api('/api/audit?limit=100');
  document.getElementById('audit-tbody').innerHTML = logs.map((l) => `<tr>
    <td>${fmtDateTime(l.at)}</td>
    <td>${escapeHtml(l.user)}</td>
    <td>${escapeHtml(ACTION_LABEL[l.action] || l.action)}</td>
    <td>${escapeHtml(l.target_name) || '-'}</td>
    <td>${escapeHtml(l.detail) || '-'}</td>
  </tr>`).join('');
  document.getElementById('audit-empty').hidden = logs.length > 0;
}

async function reloadHistoryTab() {
  await Promise.all([loadTrash(), loadAudit()]);
}

document.getElementById('tab-history').addEventListener('click', async (e) => {
  const t = e.target;
  const errEl = document.getElementById('trash-err');
  errEl.hidden = true;

  if (t.dataset.restore) {
    try {
      await api(`/api/trash/${t.dataset.restore}/${t.dataset.restoreId}/restore`, { method: 'POST' });
      await Promise.all([reloadHistoryTab(), refreshAll()]);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
    return;
  }

  if (t.dataset.purge) {
    const ok = await confirmDialog({
      title: '完全削除',
      message: `「${t.dataset.purgeName}」を完全に削除します。\nこの操作は取り消せません。よろしいですか？`,
      okLabel: '完全に削除する',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/trash/${t.dataset.purge}/${t.dataset.purgeId}`, { method: 'DELETE' });
      await reloadHistoryTab();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  }
});

/* ================= 初期化 ================= */

// 背景（グレーアウト部分）のクリックでダイアログを閉じる。
// dialog要素自身にはpaddingが無く中身は子要素なので、e.targetがdialogなら背景クリック。
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) closeDialog(dlg);
  });
});

async function refreshAll() {
  await Promise.all([loadParts(), loadServers(), loadCategories(), loadSyncReports(), loadDashboard()]);
  // サーバー一覧を読み終えてからでないと対象サーバーの選択肢を作れない
  await loadCommandBuilder();
}

(async () => {
  try {
    // バージョンはpackage.jsonを唯一の情報源としてサーバーから取得する
    const { version } = await api('/api/version');
    document.getElementById('app-version').textContent = `v${version}`;
    document.getElementById('auth-version').textContent = `v${version}`;
  } catch { /* 取得できなくても動作には影響しない */ }

  try {
    const state = await api('/api/auth/state');
    if (state.user) await showApp(state.user);
    else showAuthScreen(state);
  } catch (err) {
    alert(`起動に失敗しました: ${err.message}`);
  }
})();
