'use strict';

/* ── Constants ──────────────────────────────────── */
const STORAGE_KEY  = 'money-v2';
const CATEGORIES   = ['식비','교통','쇼핑','의료','문화','주거','급여','용돈','기타'];
const PIE_COLORS   = ['#ef5350','#42a5f5','#66bb6a','#ffa726','#ab47bc','#26c6da','#ec407a','#8d6e63','#78909c'];
const DEFAULT_ACCS = ['현금','카드','통장'];

/* ── State ──────────────────────────────────────── */
let state = loadState();
let currentMonth = todayYM();
let deletedStack  = [];
let undoTimer     = null;
let chartMonthly, chartCategory, chartTrend;

/* ── Boot ───────────────────────────────────────── */
applyDarkMode();
populateSelects();
document.getElementById('date').value = todayString();
setupListeners();
switchTab('home');

/* ══════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════ */
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return ensureDefaults(saved);
    // Migrate v1
    const v1 = JSON.parse(localStorage.getItem('money-entries'));
    if (v1 && Array.isArray(v1)) {
      const s = defaultState();
      s.entries = v1.map(e => ({ ...e, account: e.account || '현금', tags: e.tags || [], memo: e.memo || '' }));
      return s;
    }
    return defaultState();
  } catch { return defaultState(); }
}

function defaultState() {
  return { entries: [], budgets: {}, recurring: [], accounts: [...DEFAULT_ACCS], savingsGoal: 0, darkMode: false, openaiKey: '' };
}

function ensureDefaults(s) {
  s.entries     = s.entries     || [];
  s.budgets     = s.budgets     || {};
  s.recurring   = s.recurring   || [];
  s.accounts    = s.accounts    || [...DEFAULT_ACCS];
  s.savingsGoal = s.savingsGoal || 0;
  s.darkMode    = s.darkMode    || false;
  s.openaiKey   = s.openaiKey   || '';
  return s;
}

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

/* ══════════════════════════════════════════════════
   TABS
══════════════════════════════════════════════════ */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('active', el.id === `tab-${tab}`));
  if (tab === 'home')     renderHome();
  if (tab === 'calendar') renderCalendar();
  if (tab === 'charts')   renderCharts();
  if (tab === 'budget')   renderBudget();
  if (tab === 'settings') renderSettings();
}

/* ══════════════════════════════════════════════════
   HOME
══════════════════════════════════════════════════ */
function renderHome() {
  setMonthLabel('current-month-label');
  updateSummary();
  renderList();
}

function setMonthLabel(id) {
  const [y, m] = currentMonth.split('-');
  document.getElementById(id).textContent = `${y}년 ${+m}월`;
}

function monthEntries(ym = currentMonth) {
  return state.entries.filter(e => e.date.startsWith(ym));
}

function updateSummary() {
  const cur  = monthEntries();
  const prev = monthEntries(prevYM(currentMonth));
  const income  = sumType(cur,  'income');
  const expense = sumType(cur,  'expense');
  const balance = income - expense;
  const pIncome  = sumType(prev, 'income');
  const pExpense = sumType(prev, 'expense');

  setText('total-income',  `+${fmt(income)}원`);
  setText('total-expense', `-${fmt(expense)}원`);
  setText('balance',       `${balance >= 0 ? '+' : ''}${fmt(balance)}원`);
  document.getElementById('balance').style.color = '';

  renderDiff('income-diff',  income,  pIncome);
  renderDiff('expense-diff', expense, pExpense);

  if (state.savingsGoal > 0) {
    const pct = Math.min(100, Math.round(balance / state.savingsGoal * 100));
    setText('savings-goal-info', `저축 목표 ${pct}% 달성`);
  } else {
    setText('savings-goal-info', '');
  }
}

function renderDiff(id, cur, prev) {
  const el = document.getElementById(id);
  if (prev === 0) { el.textContent = ''; el.className = 'diff'; return; }
  const d   = cur - prev;
  const pct = Math.round(Math.abs(d) / prev * 100);
  if (d > 0)      { el.textContent = `▲ ${pct}%`; el.className = 'diff up'; }
  else if (d < 0) { el.textContent = `▼ ${pct}%`; el.className = 'diff down'; }
  else            { el.textContent = '변동 없음';  el.className = 'diff'; }
}

function renderList() {
  const query = document.getElementById('search').value.trim().toLowerCase();
  const fType = document.getElementById('filter-type').value;
  const fCat  = document.getElementById('filter-category').value;
  const fAcc  = document.getElementById('filter-account').value;

  const filtered = monthEntries()
    .filter(e => {
      if (fType !== 'all' && e.type     !== fType) return false;
      if (fCat  !== 'all' && e.category !== fCat)  return false;
      if (fAcc  !== 'all' && e.account  !== fAcc)  return false;
      if (query && !e.description.toLowerCase().includes(query)) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const list  = document.getElementById('entry-list');
  const empty = document.getElementById('empty-msg');
  list.innerHTML = '';

  if (filtered.length === 0) { empty.classList.add('visible'); return; }
  empty.classList.remove('visible');
  filtered.forEach(e => list.appendChild(buildEntryEl(e)));
}

function buildEntryEl(entry) {
  const li   = document.createElement('li');
  li.className = `entry-item ${entry.type}`;
  const sign = entry.type === 'income' ? '+' : '-';
  const tagsHtml = (entry.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
  li.innerHTML = `
    <span class="entry-date">${fmtDate(entry.date)}</span>
    <span class="entry-desc" title="${esc(entry.memo || '')}">${esc(entry.description)}</span>
    <span class="entry-category">${esc(entry.category)}</span>
    <span class="entry-account">${esc(entry.account || '-')}</span>
    <span class="entry-tags">${tagsHtml}</span>
    <span class="entry-amount">${sign}${fmt(entry.amount)}원</span>
    <button class="btn-delete" title="삭제">&#10005;</button>
  `;
  li.querySelector('.btn-delete').addEventListener('click', () => deleteEntry(entry.id));
  return li;
}

/* ── CRUD ───────────────────────────────────────── */
function addEntry(entry) {
  state.entries.unshift(entry);
  save();
  renderHome();
}

function deleteEntry(id) {
  const idx = state.entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  const [gone] = state.entries.splice(idx, 1);
  deletedStack.push(gone);
  if (deletedStack.length > 10) deletedStack.shift();
  save();
  renderHome();
  showToast(`"${gone.description}" 삭제됨`);
}

function undoDelete() {
  if (!deletedStack.length) return;
  const entry = deletedStack.pop();
  state.entries.unshift(entry);
  save();
  document.getElementById('undo-toast').classList.remove('visible');
  renderHome();
}

function showToast(msg) {
  setText('undo-msg', msg);
  document.getElementById('undo-toast').classList.add('visible');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => document.getElementById('undo-toast').classList.remove('visible'), 4000);
}

/* ══════════════════════════════════════════════════
   CALENDAR
══════════════════════════════════════════════════ */
function renderCalendar() {
  const [y, m] = currentMonth.split('-').map(Number);
  document.getElementById('cal-month-label').textContent = `${y}년 ${m}월`;

  const cal = document.getElementById('calendar');
  cal.innerHTML = '';
  document.getElementById('day-detail').innerHTML = '';

  ['일','월','화','수','목','금','토'].forEach(d => {
    const cell = document.createElement('div');
    cell.className = 'cal-header-cell';
    cell.textContent = d;
    cal.appendChild(cell);
  });

  const firstDay    = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const today       = todayString();

  for (let i = 0; i < firstDay; i++) cal.appendChild(document.createElement('div'));

  for (let d = 1; d <= daysInMonth; d++) {
    const ds   = `${currentMonth}-${String(d).padStart(2, '0')}`;
    const des  = state.entries.filter(e => e.date === ds);
    const inc  = sumType(des, 'income');
    const exp  = sumType(des, 'expense');
    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (ds === today ? ' today' : '');
    cell.innerHTML = `
      <span class="cal-day">${d}</span>
      ${inc ? `<span class="cal-income">+${fmt(inc)}</span>` : ''}
      ${exp ? `<span class="cal-expense">-${fmt(exp)}</span>` : ''}
    `;
    cell.addEventListener('click', () => showDayDetail(ds));
    cal.appendChild(cell);
  }
}

function showDayDetail(ds) {
  const detail  = document.getElementById('day-detail');
  const entries = state.entries.filter(e => e.date === ds);
  if (!entries.length) {
    detail.innerHTML = `<p class="text-muted" style="text-align:center;padding:16px">${fmtDate(ds)} 내역 없음</p>`;
    return;
  }
  detail.innerHTML = `<h4>${fmtDate(ds)} 내역</h4>` +
    entries.map(e => `
      <div class="day-detail-item ${e.type}">
        <span>${esc(e.description)}</span>
        <span class="entry-category">${esc(e.category)}</span>
        <span class="entry-amount">${e.type === 'income' ? '+' : '-'}${fmt(e.amount)}원</span>
      </div>
    `).join('');
}

/* ══════════════════════════════════════════════════
   CHARTS
══════════════════════════════════════════════════ */
function renderCharts() {
  const months    = last6Months();
  const isDark    = state.darkMode;
  const textColor = isDark ? '#aab' : '#555';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const barLineOpts = {
    responsive: true,
    plugins: {
      legend: { position: 'bottom', labels: { color: textColor, boxWidth: 12 } },
      tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}원` } },
    },
    scales: {
      y: { ticks: { callback: v => fmt(v) + '원', color: textColor }, grid: { color: gridColor } },
      x: { ticks: { color: textColor }, grid: { color: gridColor } },
    },
  };

  const doughnutOpts = {
    responsive: true,
    cutout: '58%',
    plugins: {
      legend: { position: 'bottom', labels: { color: textColor, boxWidth: 12 } },
      tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}원` } },
    },
  };

  // Monthly bar
  const barLabels = months.map(ym => `${+ym.slice(5)}월`);
  const barIncome  = months.map(ym => sumType(monthEntries(ym), 'income'));
  const barExpense = months.map(ym => sumType(monthEntries(ym), 'expense'));

  if (chartMonthly) chartMonthly.destroy();
  chartMonthly = new Chart(document.getElementById('chart-monthly'), {
    type: 'bar',
    data: {
      labels: barLabels,
      datasets: [
        { label: '수입', data: barIncome,  backgroundColor: 'rgba(102,187,106,0.8)' },
        { label: '지출', data: barExpense, backgroundColor: 'rgba(239,83,80,0.8)'   },
      ],
    },
    options: barLineOpts,
  });

  // Category doughnut
  const catMap = {};
  monthEntries().filter(e => e.type === 'expense').forEach(e => {
    catMap[e.category] = (catMap[e.category] || 0) + e.amount;
  });
  const catLabels  = Object.keys(catMap);
  const catAmounts = Object.values(catMap);

  if (chartCategory) chartCategory.destroy();
  chartCategory = new Chart(document.getElementById('chart-category'), {
    type: 'doughnut',
    data: {
      labels:   catLabels.length  ? catLabels  : ['지출 없음'],
      datasets: [{ data: catAmounts.length ? catAmounts : [1], backgroundColor: catAmounts.length ? PIE_COLORS : ['#ccc'] }],
    },
    options: doughnutOpts,
  });

  // Trend line
  const trendData = months.map(ym => sumType(monthEntries(ym), 'income') - sumType(monthEntries(ym), 'expense'));

  if (chartTrend) chartTrend.destroy();
  chartTrend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels: barLabels,
      datasets: [{
        label: '잔액',
        data: trendData,
        borderColor: '#42a5f5',
        backgroundColor: 'rgba(66,165,245,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 5,
      }],
    },
    options: { ...barLineOpts },
  });

  // Stats
  const cur      = monthEntries();
  const totalExp = sumType(cur, 'expense');
  const [cy, cm] = currentMonth.split('-').map(Number);
  const now      = new Date();
  const days     = (cy === now.getFullYear() && cm === now.getMonth() + 1)
    ? now.getDate()
    : new Date(cy, cm, 0).getDate();
  const dailyAvg = days > 0 ? Math.round(totalExp / days) : 0;
  const topCat   = catLabels.reduce((a, b) => (catMap[a] || 0) >= (catMap[b] || 0) ? a : b, '');
  const maxEntry = cur.filter(e => e.type === 'expense').reduce((a, b) => (!a || b.amount > a.amount) ? b : a, null);

  document.getElementById('stats-summary').innerHTML = `
    <div class="stat-item"><span class="stat-label">이번 달 거래 수</span><span class="stat-value">${cur.length}건</span></div>
    <div class="stat-item"><span class="stat-label">일평균 지출</span><span class="stat-value">${fmt(dailyAvg)}원</span></div>
    <div class="stat-item"><span class="stat-label">최다 지출 카테고리</span><span class="stat-value">${topCat || '-'}</span></div>
    <div class="stat-item"><span class="stat-label">최대 단일 지출</span><span class="stat-value">${maxEntry ? fmt(maxEntry.amount) + '원' : '-'}</span></div>
  `;
}

/* ══════════════════════════════════════════════════
   BUDGET
══════════════════════════════════════════════════ */
function renderBudget() {
  const [y, m] = currentMonth.split('-');
  document.getElementById('budget-month-label').textContent = `${y}년 ${+m}월`;

  const list = document.getElementById('budget-list');
  list.innerHTML = '';

  CATEGORIES.forEach(cat => {
    const budget = state.budgets[cat] || 0;
    const spent  = monthEntries().filter(e => e.type === 'expense' && e.category === cat)
                                 .reduce((s, e) => s + e.amount, 0);
    const pct    = budget > 0 ? Math.min(100, Math.round(spent / budget * 100)) : 0;
    const barCls = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : '';

    const row = document.createElement('div');
    row.className = 'budget-row';
    row.innerHTML = `
      <div class="budget-info">
        <span class="budget-cat">${cat}</span>
        <span class="budget-spent">${fmt(spent)}원 / <span class="budget-limit">${budget ? fmt(budget) + '원' : '미설정'}</span></span>
      </div>
      <div class="budget-bar-wrap"><div class="budget-bar ${barCls}" style="width:${pct}%"></div></div>
      <div class="budget-edit">
        <input type="number" class="budget-input" placeholder="예산 금액" value="${budget || ''}" min="0" />
        <button class="btn-sm">저장</button>
      </div>
    `;
    row.querySelector('.btn-sm').addEventListener('click', () => {
      state.budgets[cat] = parseInt(row.querySelector('.budget-input').value) || 0;
      save(); renderBudget();
    });
    list.appendChild(row);
  });

  document.getElementById('savings-goal-input').value = state.savingsGoal || '';

  const income  = sumType(monthEntries(), 'income');
  const expense = sumType(monthEntries(), 'expense');
  const balance = income - expense;
  const goal    = state.savingsGoal;
  const gPct    = goal > 0 ? Math.min(100, Math.round(balance / goal * 100)) : 0;

  document.getElementById('savings-goal-display').innerHTML = goal > 0 ? `
    <div class="budget-bar-wrap" style="margin-top:10px">
      <div class="budget-bar ${gPct >= 100 ? 'success' : ''}" style="width:${gPct}%"></div>
    </div>
    <p class="text-muted" style="margin-top:6px">현재 잔액 ${fmt(balance)}원 / 목표 ${fmt(goal)}원 (${gPct}%)</p>
  ` : '';
}

/* ══════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════ */
function renderSettings() {
  document.getElementById('dark-mode-toggle').checked = state.darkMode;

  // API key status
  const keyInput  = document.getElementById('openai-key-input');
  const keyStatus = document.getElementById('openai-key-status');
  if (state.openaiKey) {
    keyInput.value = state.openaiKey;
    keyStatus.textContent = '✓ API 키가 저장되어 있습니다.';
    keyStatus.style.color = 'var(--income)';
  } else {
    keyInput.value = '';
    keyStatus.textContent = 'API 키를 입력하면 AI 기능을 사용할 수 있습니다.';
    keyStatus.style.color = 'var(--text-3)';
  }

  const accList = document.getElementById('account-list');
  accList.innerHTML = state.accounts.map((a, i) => `
    <div class="account-item">
      <span>${esc(a)}</span>
      <button class="btn-delete" data-i="${i}">&#10005;</button>
    </div>
  `).join('');
  accList.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', () => {
    const i = +btn.dataset.i;
    if (state.accounts.length <= 1) { alert('최소 1개의 계좌가 필요합니다.'); return; }
    state.accounts.splice(i, 1);
    save(); populateSelects(); renderSettings();
  }));

  const recList = document.getElementById('recurring-list');
  if (!state.recurring.length) {
    recList.innerHTML = '<p class="text-muted" style="margin-bottom:10px">등록된 반복 거래가 없습니다.</p>';
  } else {
    recList.innerHTML = state.recurring.map((r, i) => `
      <div class="recurring-item">
        <span class="recurring-info">${esc(r.description)} · ${r.type === 'income' ? '수입' : '지출'} · ${esc(r.category)} · ${esc(r.account)} · 매월 ${r.day}일 · ${fmt(r.amount)}원</span>
        <button class="btn-delete" data-i="${i}">&#10005;</button>
      </div>
    `).join('');
    recList.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', () => {
      state.recurring.splice(+btn.dataset.i, 1);
      save(); renderSettings();
    }));
  }

  populateSelect('rec-category', CATEGORIES);
  populateSelect('rec-account', state.accounts);
}

/* ── Recurring ──────────────────────────────────── */
function applyRecurring() {
  if (!state.recurring.length) { alert('등록된 반복 거래가 없습니다.'); return; }
  const [y, m] = currentMonth.split('-').map(Number);
  let added = 0;
  state.recurring.forEach(r => {
    const day = Math.min(r.day, new Date(y, m, 0).getDate());
    const ds  = `${currentMonth}-${String(day).padStart(2, '0')}`;
    const dup = state.entries.some(e =>
      e.date === ds && e.description === r.description && e.amount === r.amount && e._recurring);
    if (!dup) {
      state.entries.unshift({
        id: Date.now() + Math.random(),
        date: ds, type: r.type, category: r.category,
        account: r.account, description: r.description,
        amount: r.amount, tags: [], memo: '반복 거래', _recurring: true,
      });
      added++;
    }
  });
  save();
  alert(`${added}건 추가됐습니다.`);
  renderHome();
}

/* ── CSV Export ─────────────────────────────────── */
function exportCSV() {
  const rows = [['날짜','구분','카테고리','계좌','항목','금액','태그','메모'],
    ...state.entries.map(e => [
      e.date, e.type === 'income' ? '수입' : '지출',
      e.category, e.account || '', e.description, e.amount,
      (e.tags || []).join(' '), e.memo || '',
    ])
  ];
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `가계부_${todayString()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ── CSV Import ─────────────────────────────────── */
function importCSV(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const text  = ev.target.result.replace(/^\uFEFF/, '');
    const lines = text.split('\n').filter(l => l.trim());
    let added = 0;
    lines.slice(1).forEach(line => {
      const row = parseCSVRow(line);
      if (row.length < 6) return;
      const [date, type, category, account, description, amount, tags, memo] = row;
      if (!date.trim() || !description.trim() || isNaN(+amount)) return;
      state.entries.push({
        id: Date.now() + Math.random(),
        date: date.trim(), type: type.trim() === '수입' ? 'income' : 'expense',
        category: category.trim(), account: account.trim(),
        description: description.trim(), amount: +amount,
        tags: tags ? tags.trim().split(' ').filter(Boolean) : [],
        memo: memo ? memo.trim() : '',
      });
      added++;
    });
    save(); alert(`${added}건 가져오기 완료`); renderHome();
  };
  reader.readAsText(file, 'utf-8');
}

function parseCSVRow(line) {
  const result = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (line[i] === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += line[i];
  }
  result.push(cur);
  return result;
}

/* ══════════════════════════════════════════════════
   AI — OpenAI 직접 호출 헬퍼
══════════════════════════════════════════════════ */
async function callOpenAI({ messages, json = false, maxTokens = 500 }) {
  const key = state.openaiKey && state.openaiKey.trim();
  if (!key) throw new Error('설정 탭에서 OpenAI API 키를 먼저 입력해주세요.');

  const body = {
    model: 'gpt-4o-mini',
    messages,
    temperature: json ? 0.1 : 0.7,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `API 오류 (${res.status})`;
    throw new Error(msg);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

/* ══════════════════════════════════════════════════
   AI — 자연어 입력
══════════════════════════════════════════════════ */
async function aiParse() {
  const text = document.getElementById('ai-text').value.trim();
  if (!text) return;

  const btn    = document.getElementById('ai-parse-btn');
  const result = document.getElementById('ai-parse-result');

  btn.disabled = true;
  btn.innerHTML = '<span class="ai-spinner"></span>';
  result.className = 'ai-parse-result';
  result.style.display = 'none';

  const todayISO = todayString();

  try {
    const content = await callOpenAI({
      json: true,
      maxTokens: 300,
      messages: [
        {
          role: 'system',
          content: `당신은 가계부 앱의 자연어 입력 파서입니다. 입력 텍스트를 분석해 JSON으로 반환하세요.

오늘 날짜: ${todayISO}

반환 형식 (JSON만, 설명 없음):
{"date":"YYYY-MM-DD","type":"income 또는 expense","category":"식비|교통|쇼핑|의료|문화|주거|급여|용돈|기타 중 하나","description":"항목명","amount":정수,"memo":"","tags":[]}

규칙:
- 날짜 미언급 시 오늘 사용. "어제"→-1일, "그제"→-2일
- 금액은 반드시 정수(원 단위). "1만2천"→12000, "3.5만"→35000
- 수입: 월급/급여/용돈/입금/받았다 → income, 나머지 → expense
- category는 반드시 목록 중 하나
- 파싱 불가 시 {"error":"이유"} 반환`,
        },
        { role: 'user', content: text },
      ],
    });

    const parsed = JSON.parse(content);

    if (parsed.error) throw new Error(parsed.error);
    if (!parsed.date || !parsed.type || !parsed.category || !parsed.description || !(parsed.amount > 0)) {
      throw new Error('입력 내용을 인식하지 못했습니다. 더 자세히 입력해주세요.');
    }

    showParsePreview(parsed);
  } catch (err) {
    result.className = 'ai-parse-result error visible';
    result.innerHTML = `오류: ${esc(err.message)}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-ai-icon">✦</span> AI 입력';
  }
}

function showParsePreview(data) {
  const result = document.getElementById('ai-parse-result');

  const typeLabel = data.type === 'income' ? '수입' : '지출';
  const sign      = data.type === 'income' ? '+' : '-';
  const tagsStr   = (data.tags || []).map(t => `#${t}`).join(' ');

  result.className = 'ai-parse-result visible';
  result.innerHTML = `
    <div class="ai-preview-row">
      <span class="ai-preview-badge">${esc(fmtDate(data.date))}</span>
      <span class="ai-preview-badge">${typeLabel}</span>
      <span class="ai-preview-badge">${esc(data.category)}</span>
      <strong>${esc(data.description)}</strong>
      <span class="ai-preview-amount ${data.type}">${sign}${fmt(data.amount)}원</span>
      ${tagsStr ? `<span style="color:var(--text-muted);font-size:0.82rem">${esc(tagsStr)}</span>` : ''}
    </div>
    ${data.memo ? `<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:8px">메모: ${esc(data.memo)}</p>` : ''}
    <div class="ai-preview-actions">
      <button class="ai-apply-btn" id="ai-apply-btn">폼에 적용</button>
      <button class="ai-cancel-btn" id="ai-cancel-btn">취소</button>
    </div>
  `;

  document.getElementById('ai-apply-btn').addEventListener('click', () => {
    applyParsedToForm(data);
    result.className = 'ai-parse-result';
    result.style.display = 'none';
    document.getElementById('ai-text').value = '';
  });

  document.getElementById('ai-cancel-btn').addEventListener('click', () => {
    result.className = 'ai-parse-result';
    result.style.display = 'none';
  });
}

function applyParsedToForm(data) {
  if (data.date) document.getElementById('date').value = data.date;

  const typeEl = document.getElementById('type');
  typeEl.value = data.type || 'expense';

  const catEl = document.getElementById('category');
  if (data.category && CATEGORIES.includes(data.category)) catEl.value = data.category;

  if (data.description) document.getElementById('description').value = data.description;
  if (data.amount)      document.getElementById('amount').value      = data.amount;
  if (data.memo)        document.getElementById('memo').value        = data.memo;
  if (data.tags && data.tags.length)
    document.getElementById('tags').value = data.tags.map(t => '#' + t).join(' ');

  // Scroll to form
  document.getElementById('entry-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('description').focus();
}

/* ══════════════════════════════════════════════════
   AI — 지출 분석
══════════════════════════════════════════════════ */
async function aiAnalyze() {
  const btn      = document.getElementById('ai-analyze-btn');
  const bodyEl   = document.getElementById('ai-analysis-body');

  btn.disabled = true;
  btn.innerHTML = '<span class="ai-spinner"></span>';
  bodyEl.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">분석 중입니다...</p>';

  const entries = monthEntries();

  if (entries.length === 0) {
    bodyEl.innerHTML = '<p class="text-muted ai-placeholder">이번 달 등록된 내역이 없습니다.</p>';
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-ai-icon">✦</span> 분석 생성';
    return;
  }

  const catMap = {};
  entries.filter(e => e.type === 'expense').forEach(e => {
    catMap[e.category] = (catMap[e.category] || 0) + e.amount;
  });

  const income  = sumType(entries, 'income');
  const expense = sumType(entries, 'expense');
  const balance = income - expense;

  const overBudget = Object.entries(catMap)
    .filter(([cat, spent]) => state.budgets[cat] && spent > state.budgets[cat])
    .map(([cat, spent]) => `${cat}(예산 ${fmt(state.budgets[cat])}원 → ${fmt(spent)}원 사용)`);

  const dataStr = [
    `분석 월: ${currentMonth}`,
    `수입: ${fmt(income)}원 / 지출: ${fmt(expense)}원 / 잔액: ${fmt(balance)}원`,
    `거래 건수: ${entries.length}건`,
    state.savingsGoal ? `저축 목표: ${fmt(state.savingsGoal)}원 (달성률 ${Math.min(100, Math.round(balance / state.savingsGoal * 100))}%)` : '',
    `카테고리별 지출: ${JSON.stringify(catMap)}`,
    overBudget.length ? `예산 초과: ${overBudget.join(', ')}` : '',
    `상위 지출: ${JSON.stringify(entries.filter(e=>e.type==='expense').sort((a,b)=>b.amount-a.amount).slice(0,8).map(e=>({desc:e.description,cat:e.category,amt:e.amount})))}`,
  ].filter(Boolean).join('\n');

  try {
    const content = await callOpenAI({
      json: false,
      maxTokens: 600,
      messages: [
        {
          role: 'system',
          content: `당신은 친근한 가계부 AI 어시스턴트입니다.
사용자의 지출 데이터를 분석하고 마크다운으로 간결한 리포트를 작성하세요.

구조 (각 섹션 2-3줄):
## 이번 달 요약
## 주요 지출 패턴
## 절약 포인트
## 다음 달 제안

규칙: 한국어, 친근한 톤, 구체적 숫자, 전체 400자 이내`,
        },
        { role: 'user', content: dataStr },
      ],
    });

    bodyEl.innerHTML = `<div class="ai-md">${renderMarkdown(content)}</div>`;
  } catch (err) {
    bodyEl.innerHTML = `<p style="color:var(--expense);padding:8px 0">오류: ${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-ai-icon">✦</span> 다시 분석';
  }
}

/* ── Simple Markdown renderer ───────────────────── */
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // H4 ### / H3 ##
    .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gm,  '<h4>$1</h4>')
    .replace(/^##\s+(.+)$/gm,   '<h3>$1</h3>')
    // Unordered list items
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`)
    // Paragraphs (double newline)
    .replace(/\n\n+/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, (m, p) => p ? `<p>${p}</p>` : '')
    // Clean up empty tags
    .replace(/<p><\/p>/g, '');
}

/* ══════════════════════════════════════════════════
   EVENT LISTENERS
══════════════════════════════════════════════════ */
function setupListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Form submit
  document.getElementById('entry-form').addEventListener('submit', e => {
    e.preventDefault();
    const tagsRaw = document.getElementById('tags').value.trim();
    const tags    = tagsRaw.split(/\s+/).filter(t => t).map(t => t.startsWith('#') ? t.slice(1) : t);
    addEntry({
      id:          Date.now(),
      date:        document.getElementById('date').value,
      type:        document.getElementById('type').value,
      category:    document.getElementById('category').value,
      account:     document.getElementById('account').value,
      description: document.getElementById('description').value.trim(),
      amount:      +document.getElementById('amount').value,
      tags,
      memo:        document.getElementById('memo').value.trim(),
    });
    ['description','amount','tags','memo'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('description').focus();
  });

  // Month nav — home
  document.getElementById('prev-month').addEventListener('click', () => { currentMonth = prevYM(currentMonth); renderHome(); });
  document.getElementById('next-month').addEventListener('click', () => { currentMonth = nextYM(currentMonth); renderHome(); });

  // Month nav — calendar
  document.getElementById('cal-prev-month').addEventListener('click', () => { currentMonth = prevYM(currentMonth); renderCalendar(); });
  document.getElementById('cal-next-month').addEventListener('click', () => { currentMonth = nextYM(currentMonth); renderCalendar(); });

  // Month nav — budget
  document.getElementById('budget-prev-month').addEventListener('click', () => { currentMonth = prevYM(currentMonth); renderBudget(); });
  document.getElementById('budget-next-month').addEventListener('click', () => { currentMonth = nextYM(currentMonth); renderBudget(); });

  // Filters
  ['search','filter-type','filter-category','filter-account'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderList);
    document.getElementById(id).addEventListener('change', renderList);
  });

  // Clear month
  document.getElementById('clear-all').addEventListener('click', () => {
    if (!monthEntries().length) return;
    if (!confirm('이번 달 모든 내역을 삭제하시겠습니까?')) return;
    state.entries = state.entries.filter(e => !e.date.startsWith(currentMonth));
    save(); renderHome();
  });

  // Undo
  document.getElementById('undo-btn').addEventListener('click', undoDelete);

  // Dark mode
  document.getElementById('dark-mode-toggle').addEventListener('change', e => {
    state.darkMode = e.target.checked; save(); applyDarkMode();
  });

  // Account add
  document.getElementById('add-account-btn').addEventListener('click', () => {
    const val = document.getElementById('new-account').value.trim();
    if (!val) return;
    if (state.accounts.includes(val)) { alert('이미 존재하는 계좌입니다.'); return; }
    state.accounts.push(val); save();
    document.getElementById('new-account').value = '';
    populateSelects(); renderSettings();
  });

  // Recurring add
  document.getElementById('add-recurring-btn').addEventListener('click', () => {
    const desc   = document.getElementById('rec-desc').value.trim();
    const amount = +document.getElementById('rec-amount').value;
    const day    = +document.getElementById('rec-day').value;
    if (!desc || !amount || !day) { alert('모든 항목을 입력해주세요.'); return; }
    state.recurring.push({
      description: desc,
      type:     document.getElementById('rec-type').value,
      category: document.getElementById('rec-category').value,
      account:  document.getElementById('rec-account').value,
      amount, day,
    });
    save();
    ['rec-desc','rec-amount','rec-day'].forEach(id => document.getElementById(id).value = '');
    renderSettings();
  });

  document.getElementById('apply-recurring-btn').addEventListener('click', applyRecurring);

  // Savings goal
  document.getElementById('savings-goal-save').addEventListener('click', () => {
    state.savingsGoal = +document.getElementById('savings-goal-input').value || 0;
    save(); renderBudget();
  });

  // OpenAI API key
  document.getElementById('openai-key-save').addEventListener('click', () => {
    const val = document.getElementById('openai-key-input').value.trim();
    if (!val) { alert('API 키를 입력해주세요.'); return; }
    if (!val.startsWith('sk-')) { alert('올바른 OpenAI API 키 형식이 아닙니다. (sk-로 시작해야 합니다)'); return; }
    state.openaiKey = val;
    save();
    renderSettings();
  });

  // CSV
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('import-csv-input').addEventListener('change', e => {
    if (e.target.files[0]) importCSV(e.target.files[0]);
    e.target.value = '';
  });

  // AI — 자연어 입력
  document.getElementById('ai-parse-btn').addEventListener('click', aiParse);
  document.getElementById('ai-text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiParse(); }
  });

  // AI — 접기/펼치기
  document.getElementById('ai-collapse-btn').addEventListener('click', () => {
    const body = document.getElementById('ai-input-body');
    const btn  = document.getElementById('ai-collapse-btn');
    body.classList.toggle('collapsed');
    btn.style.transform = body.classList.contains('collapsed') ? 'rotate(-90deg)' : '';
  });

  // AI — 분석
  document.getElementById('ai-analyze-btn').addEventListener('click', aiAnalyze);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') {
      document.getElementById('entry-form').requestSubmit();
    }
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault(); undoDelete();
    }
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      state.darkMode = !state.darkMode; save(); applyDarkMode();
      document.getElementById('dark-mode-toggle').checked = state.darkMode;
    }
    if (e.key === 'Escape') {
      ['description','amount','tags','memo'].forEach(id => document.getElementById(id).value = '');
    }
  });
}

/* ══════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════ */
function applyDarkMode() { document.body.classList.toggle('dark', state.darkMode); }

function populateSelects() {
  populateSelect('category', CATEGORIES);
  populateSelect('account',  state.accounts);

  const fc = document.getElementById('filter-category');
  fc.innerHTML = '<option value="all">카테고리 전체</option>' +
    CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  const fa = document.getElementById('filter-account');
  fa.innerHTML = '<option value="all">계좌 전체</option>' +
    state.accounts.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
}

function populateSelect(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = items.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (items.includes(cur)) el.value = cur;
}

function sumType(entries, type) {
  return entries.filter(e => e.type === type).reduce((s, e) => s + e.amount, 0);
}

function fmt(n)         { return Math.abs(n).toLocaleString('ko-KR'); }
function setText(id, v) { document.getElementById(id).textContent = v; }

function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${y}.${m}.${d}`;
}

function todayString() { return new Date().toISOString().slice(0, 10); }
function todayYM()     { return todayString().slice(0, 7); }

function prevYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function last6Months() {
  let ym = currentMonth;
  const result = [];
  for (let i = 0; i < 6; i++) { result.unshift(ym); ym = prevYM(ym); }
  return result;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
