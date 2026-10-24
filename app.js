import { createBackup, parseBackup } from './backup.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './sync-config.js';
import { MoneyNoteSync, diffRecords, LOCAL_DIRTY_KEY } from './sync.js';
import { annualCategorySeries, annualReport, budgetAlerts, budgetComparison, dueRecurring, filterTransactions, monthlyExpenseDays } from './features.js';
import { CATEGORY_ICON_OPTIONS, categoryIconSymbol, categoryIconValue, categoryIconsForType } from './category-icons.js';
import { APP_VERSION } from './version.js';

const STORAGE_KEY = 'moneynote.v1';
const palette = ['#d16d8b', '#f2ae8f', '#99cc7a', '#dce7d6', '#b5a0ce', '#dfc27c', '#9db9ad', '#c3cfaa'];
const defaultCategories = [
  { id: 'food', name: 'Ăn uống', type: 'expense', icon: 'food' },
  { id: 'shopping', name: 'Mua sắm', type: 'expense', icon: 'shopping' },
  { id: 'home', name: 'Nhà cửa', type: 'expense', icon: 'home' },
  { id: 'transport', name: 'Di chuyển', type: 'expense', icon: 'transport' },
  { id: 'health', name: 'Sức khỏe', type: 'expense', icon: 'health' },
  { id: 'learning', name: 'Học tập', type: 'expense', icon: 'learning' },
  { id: 'fun', name: 'Giải trí', type: 'expense', icon: 'entertainment' },
  { id: 'other-expense', name: 'Khác', type: 'expense', icon: 'other' },
  { id: 'salary', name: 'Lương', type: 'income', icon: 'salary' },
  { id: 'bonus', name: 'Thưởng', type: 'income', icon: 'gift' },
  { id: 'other-income', name: 'Thu nhập khác', type: 'income', icon: 'coins' },
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value || 0)} ₫`;
const compactMoney = (value) => value >= 1000000 ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value / 1000000)}tr` : value >= 1000 ? `${Math.round(value / 1000)}k` : `${value || 0}₫`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const iconSvg = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${name}" /></svg>`;
const categoryIconHtml = (value, categoryId) => {
  const symbol = categoryIconSymbol(value, categoryId);
  return symbol ? iconSvg(symbol) : `<span class="category-glyph">${escapeHtml(value || '◈')}</span>`;
};
const todayLocal = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const currentMonth = () => todayLocal().slice(0, 7);
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const monthName = (value) => { const [year, month] = value.split('-'); return `tháng ${Number(month)}/${year}`; };
const dateName = (value) => { const [year, month, day] = value.split('-'); return `${day}/${month}/${year}`; };
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const sum = (items) => items.reduce((total, item) => total + item.amount, 0);
const amountDigits = (value) => String(value ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const formatAmountInput = (value) => amountDigits(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || !Array.isArray(saved.transactions) || !Array.isArray(saved.categories)) throw new Error('No saved data');
    return {
      transactions: saved.transactions.filter((item) => item && typeof item.id === 'string' && ['income', 'expense'].includes(item.type) && Number.isSafeInteger(item.amount) && item.amount > 0 && validDate(item.date)),
      categories: saved.categories.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && ['income', 'expense'].includes(item.type)),
      budgets: saved.budgets && typeof saved.budgets === 'object' ? saved.budgets : {},
      templates: Array.isArray(saved.templates) ? saved.templates.filter((item) => item && typeof item.id === 'string' && Number.isSafeInteger(item.amount) && item.amount > 0 && ['income', 'expense'].includes(item.type)) : [],
      recurring: Array.isArray(saved.recurring) ? saved.recurring.filter((item) => item && typeof item.id === 'string' && Number.isSafeInteger(item.amount) && item.amount > 0 && Number.isInteger(item.day) && item.day >= 1 && item.day <= 31 && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.startMonth)) : [],
    };
  } catch {
    return { transactions: [], categories: structuredClone(defaultCategories), budgets: {}, templates: [], recurring: [] };
  }
}

let state = loadState();
let lastSavedState = structuredClone(state);
let selectedMonth = currentMonth();
let selectedYear = selectedMonth.slice(0, 4);
let selectedTrendCategory = '';
let activeView = 'overview';
let toastTimer;
let pendingRestore;
let sync;
let supabaseClient;
let sessionUser;
let connectingUserId;
let currentConflictKey;
const deferredConflicts = new Set();

function saveState() {
  const changes = diffRecords(lastSavedState, state);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { toast('Không thể lưu trên thiết bị. Hãy sao lưu JSON để giữ dữ liệu.'); return false; }
  lastSavedState = structuredClone(state);
  if (sync?.active) sync.queueChanges(changes);
  else if (changes.length && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
    try { localStorage.setItem(LOCAL_DIRTY_KEY, '1'); } catch { toast('Không thể đánh dấu thay đổi chưa đồng bộ'); }
  }
  return true;
}

function acceptRemoteState(next) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  catch { throw new Error('Không thể lưu dữ liệu đám mây trên thiết bị'); }
  state = next;
  lastSavedState = structuredClone(next);
  render();
}

function setSyncStatus(message) {
  $('#sync-status').textContent = message;
  $('#sync-dialog-status').textContent = message;
  $('#storage-caption').textContent = message;
  $('#sync-status-button').title = message;
}

function updateSyncDialog() {
  const configured = !!SUPABASE_URL && !!SUPABASE_PUBLISHABLE_KEY;
  $('#sync-help').textContent = !configured
    ? 'Chưa cấu hình Supabase. Tạo dự án, chạy tệp supabase/schema.sql rồi điền Project URL và publishable key vào sync-config.js. Xem README để làm từng bước.'
    : sessionUser ? `Đang đăng nhập: ${sessionUser.email || 'tài khoản Supabase'}. Thay đổi được lưu trên thiết bị trước, rồi gửi lên đám mây khi có mạng.`
      : 'Nhập email để nhận liên kết đăng nhập. Dùng cùng email trên điện thoại và máy tính để xem chung dữ liệu.';
  $('#sync-login-form').hidden = !configured || !!sessionUser;
  $('#sync-refresh').hidden = !sessionUser;
  $('#sync-logout').hidden = !sessionUser;
}

function chooseInitialData(local, remoteRows, { differentAccount } = {}) {
  return new Promise((resolve) => {
    const dialog = $('#sync-choice-dialog');
    $('#sync-choice-summary').textContent = `Thiết bị này có ${local.transactions.length} giao dịch. Đám mây có ${remoteRows.filter((row) => row.kind === 'transaction' && !row.deleted).length} giao dịch.${differentAccount ? ' Dữ liệu trên thiết bị có thể thuộc tài khoản đã đăng nhập trước đó.' : ''} Chọn cách kết nối trước khi đồng bộ.`;
    const finish = (choice) => { dialog.close(); dialog.oncancel = null; resolve(choice); };
    $('#sync-choice-backup').onclick = exportBackup;
    $('#sync-choice-cancel').onclick = () => finish('cancel');
    $('#sync-choice-cloud').onclick = () => finish('cloud');
    $('#sync-choice-merge').onclick = () => finish('merge');
    dialog.oncancel = (event) => { event.preventDefault(); finish('cancel'); };
    dialog.showModal();
  });
}

async function handleSession(session) {
  const user = session?.user;
  if (!user) {
    if (sessionUser) sync?.signOut();
    sessionUser = null;
    updateSyncDialog();
    return;
  }
  if (sessionUser?.id === user.id && (sync?.active || connectingUserId === user.id)) return;
  sessionUser = user;
  updateSyncDialog();
  connectingUserId = user.id;
  try { await sync?.start(user.id); }
  finally { if (connectingUserId === user.id) connectingUserId = null; }
}

async function initializeSync() {
  updateSyncDialog();
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return;
  try {
    const { createClient } = await import('./vendor/supabase.js');
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    sync = new MoneyNoteSync({ client: supabaseClient, storage: localStorage, defaults: defaultCategories, getState: () => state, acceptState: acceptRemoteState, chooseInitialData, setStatus: setSyncStatus, onConflicts: showConflicts });
    supabaseClient.auth.onAuthStateChange((_event, session) => { setTimeout(() => handleSession(session), 0); });
  } catch (error) { setSyncStatus(`Không thể khởi tạo đồng bộ: ${error.message}`); }
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function categoryById(id) { return state.categories.find((item) => item.id === id); }
function monthlyTransactions(month = selectedMonth) { return state.transactions.filter((item) => item.date.slice(0, 7) === month); }
function sorted(items) { return [...items].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')); }
function budgetForMonth() {
  const entry = state.budgets[selectedMonth];
  return entry && typeof entry === 'object' ? entry : { total: 0, categories: {} };
}
function ensureBudget() {
  if (!state.budgets[selectedMonth] || typeof state.budgets[selectedMonth] !== 'object') state.budgets[selectedMonth] = { total: 0, categories: {} };
  if (!state.budgets[selectedMonth].categories || typeof state.budgets[selectedMonth].categories !== 'object') state.budgets[selectedMonth].categories = {};
  return state.budgets[selectedMonth];
}
function amountInput(value, allowZero = false) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= (allowZero ? 0 : 1) && amount <= 999999999999 ? amount : null;
}

function setView(view) {
  if (!['overview', 'transactions', 'budgets', 'yearly', 'categories'].includes(view)) return;
  activeView = view;
  document.body.classList.toggle('yearly-view', view === 'yearly');
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === view));
  $$('[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $('#breadcrumb-current').textContent = { overview: 'Tổng quan', transactions: 'Giao dịch', budgets: 'Ngân sách', yearly: 'Theo năm', categories: 'Danh mục' }[view];
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function render() {
  $$('[data-month-label]').forEach((el) => { el.textContent = monthName(selectedMonth); });
  $('#month-input').value = selectedMonth;
  const items = monthlyTransactions();
  const incomeItems = items.filter((item) => item.type === 'income');
  const expenseItems = items.filter((item) => item.type === 'expense');
  const income = sum(incomeItems), expense = sum(expenseItems);
  $('#balance-total').textContent = money(income - expense);
  $('#income-total').textContent = money(income);
  $('#expense-total').textContent = money(expense);
  $('#income-count').textContent = incomeItems.length;
  $('#expense-count').textContent = expenseItems.length;
  renderCashflow();
  renderDailyInsights();
  renderYearly();
  renderCategoryChart(expenseItems);
  renderOverviewBudget(expense);
  renderRecent(items);
  renderTransactionFilters();
  renderTransactions();
  renderBudgets(expense);
  renderBudgetAlerts();
  renderCategories();
  renderTemplates();
  renderRecurring();
}

function lineChart(values, labels, color, ariaLabel, markerIndexes = []) {
  const width = window.matchMedia('(max-width:640px)').matches ? 380 : 716;
  const right = width - 37;
  const max = Math.max(1, ...values);
  const x = (index) => 37 + index / Math.max(1, values.length - 1) * (right - 37);
  const y = (value) => 164 - value / max * 132;
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const area = `${x(0)},164 ${points} ${x(values.length - 1)},164`;
  const ticks = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])];
  return `<svg class="insight-line-chart" viewBox="0 0 ${width} 200" role="img" aria-label="${escapeHtml(ariaLabel)}"><line x1="37" y1="164" x2="${right}" y2="164" class="chart-axis"/><line x1="37" y1="98" x2="${right}" y2="98" class="chart-grid"/><line x1="37" y1="32" x2="${right}" y2="32" class="chart-grid"/><text x="35" y="24" class="chart-value">${compactMoney(max)}</text><polygon points="${area}" fill="${color}" opacity=".12"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${markerIndexes.map((index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(values[index]).toFixed(1)}" r="4" fill="${color}" stroke="#fff" stroke-width="2"><title>${escapeHtml(labels[index])}: ${money(values[index])}</title></circle>`).join('')}${ticks.map((index) => `<text x="${x(index).toFixed(1)}" y="188" text-anchor="middle" class="chart-tick">${escapeHtml(labels[index])}</text>`).join('')}</svg>`;
}

function renderDailyInsights() {
  const report = monthlyExpenseDays(state, selectedMonth);
  const spendingDays = report.days.filter((day) => day.amount > 0).length;
  $('#cumulative-chart').innerHTML = report.total
    ? lineChart(report.days.map((day) => day.cumulative), report.days.map((day) => `Ngày ${day.day}`), '#ca6685', `Chi tiêu lũy kế ${monthName(selectedMonth)}: ${money(report.total)}`, report.days.flatMap((day, index) => day.amount ? [index] : []))
    : '<div class="empty-state"><strong>Chưa có khoản chi trong tháng</strong>Biểu đồ lũy kế sẽ xuất hiện khi bạn ghi khoản chi.</div>';
  $('#cumulative-caption').textContent = report.total ? `${spendingDays} ngày có chi · Tổng ${money(report.total)}` : '';

  const max = Math.max(1, ...report.days.map((day) => day.amount));
  const weekdayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const blanks = Array.from({ length: report.offset }, () => '<span class="heatmap-blank" aria-hidden="true"></span>').join('');
  $('#expense-heatmap').innerHTML = `<div class="heatmap-weekdays">${weekdayNames.map((name) => `<span>${name}</span>`).join('')}</div><div class="heatmap-days">${blanks}${report.days.map((day) => {
    const level = day.amount ? Math.max(1, Math.ceil(day.amount / max * 4)) : 0;
    const date = `${selectedMonth}-${String(day.day).padStart(2, '0')}`;
    return `<button class="heatmap-day level-${level}" data-heat-date="${date}" aria-label="Ngày ${day.day}, chi ${money(day.amount)}" title="${dateName(date)} · Chi ${money(day.amount)}">${day.day}</button>`;
  }).join('')}</div><div class="heatmap-legend"><span>Ít chi</span>${[0, 1, 2, 3, 4].map((level) => `<i class="level-${level}"></i>`).join('')}<span>Nhiều chi</span></div>`;
}

function renderYearly() {
  const years = [...new Set([selectedYear, currentMonth().slice(0, 4), ...state.transactions.map((item) => item.date.slice(0, 4))])].sort((a, b) => b.localeCompare(a));
  $('#year-input').innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join('');
  $('#year-input').value = selectedYear;

  const report = annualReport(state, selectedYear);
  const expenseCount = report.transactions.filter((item) => item.type === 'expense').length;
  const incomeCount = report.transactions.filter((item) => item.type === 'income').length;
  $('#year-expense-total').textContent = money(report.expenseTotal);
  $('#year-income-total').textContent = money(report.incomeTotal);
  $('#year-net-total').textContent = money(report.incomeTotal - report.expenseTotal);
  $('#year-expense-caption').textContent = `${expenseCount} giao dịch chi`;
  $('#year-income-caption').textContent = `${incomeCount} giao dịch thu`;

  const max = Math.max(1, ...report.months.flatMap((month) => [month.income, month.expense]));
  $('#yearly-chart').innerHTML = report.months.map((month) => `<div class="yearly-chart-col"><div class="yearly-bar-area"><span class="yearly-bar income" style="height:${month.income ? Math.max(3, month.income / max * 100) : 0}%" title="Tháng ${month.number}: thu ${money(month.income)}"></span><span class="yearly-bar expense" style="height:${month.expense ? Math.max(3, month.expense / max * 100) : 0}%" title="Tháng ${month.number}: chi ${money(month.expense)}"></span></div><span>T${month.number}</span></div>`).join('');
  $('#yearly-chart').setAttribute('aria-label', `Thu và chi theo 12 tháng năm ${selectedYear}. Tổng thu ${money(report.incomeTotal)}, tổng chi ${money(report.expenseTotal)}.`);

  $('#yearly-categories').innerHTML = report.categories.length
    ? report.categories.map(({ id, amount }, index) => {
      const category = categoryById(id);
      const percent = Math.round(amount / report.expenseTotal * 100);
      return `<div class="yearly-category-row"><span class="category-badge">${categoryIconHtml(category?.icon, id)}</span><div class="yearly-category-info"><div><strong>${escapeHtml(category?.name || 'Danh mục đã xóa')}</strong><span>${percent}%</span></div><div class="yearly-category-track"><i style="width:${amount / report.expenseTotal * 100}%;background:${palette[index % palette.length]}"></i></div></div><strong class="yearly-category-amount">${money(amount)}</strong></div>`;
    }).join('')
    : '<div class="empty-state"><strong>Chưa có khoản chi trong năm này</strong>Chọn năm khác hoặc ghi khoản chi để xem phân bổ.</div>';

  $('#yearly-months').innerHTML = report.months.map((month) => `<button class="yearly-month-row" data-year-month="${selectedYear}-${String(month.number).padStart(2, '0')}" title="Xem tháng ${month.number}/${selectedYear}"><span>Tháng ${month.number}</span><span>${money(month.income)}</span><span class="yearly-expense-value">${money(month.expense)}</span><span class="${month.income - month.expense < 0 ? 'yearly-negative' : ''}">${money(month.income - month.expense)}</span></button>`).join('');
  renderYearlyStacked(report);
  renderCategoryTrend(report);
}

function renderYearlyStacked(report) {
  const series = annualCategorySeries(state, selectedYear);
  const max = Math.max(1, ...report.months.map((month) => month.expense));
  $('#yearly-stacked').innerHTML = report.expenseTotal
    ? `<div class="stacked-chart" role="img" aria-label="Chi tiêu theo danh mục của 12 tháng năm ${selectedYear}">${series.months.map((month) => {
      const total = month.segments.reduce((sum, item) => sum + item.amount, 0);
      return `<div class="stacked-col"><div class="stacked-bar-area"><div class="stacked-bar" style="height:${total / max * 100}%">${month.segments.map((segment, index) => segment.amount ? `<span style="height:${segment.amount / total * 100}%;background:${palette[index % palette.length]}" title="Tháng ${month.number} · ${escapeHtml(segment.id === null ? 'Danh mục khác' : categoryById(segment.id)?.name || 'Danh mục đã xóa')}: ${money(segment.amount)}"></span>` : '').join('')}</div></div><span>T${month.number}</span></div>`;
    }).join('')}</div>`
    : '<div class="empty-state"><strong>Chưa có khoản chi trong năm</strong>Biểu đồ danh mục sẽ xuất hiện khi bạn ghi khoản chi.</div>';
  $('#yearly-stacked-legend').innerHTML = report.expenseTotal ? series.categories.map(({ id }, index) => `<span><i style="background:${palette[index % palette.length]}"></i>${escapeHtml(id === null ? 'Danh mục khác' : categoryById(id)?.name || 'Danh mục đã xóa')}</span>`).join('') : '';
}

function renderCategoryTrend(report) {
  const categoryIds = [...new Set([...state.categories.filter((item) => item.type === 'expense').map((item) => item.id), ...report.categories.map((item) => item.id)])];
  if (!categoryIds.includes(selectedTrendCategory)) selectedTrendCategory = report.categories[0]?.id || categoryIds[0] || '';
  $('#trend-category').innerHTML = categoryIds.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(categoryById(id)?.name || 'Danh mục đã xóa')}</option>`).join('');
  $('#trend-category').value = selectedTrendCategory;
  $('#trend-category').disabled = !categoryIds.length;
  const values = Array.from({ length: 12 }, (_, index) => report.transactions.filter((item) => item.type === 'expense' && item.categoryId === selectedTrendCategory && Number(item.date.slice(5, 7)) === index + 1).reduce((total, item) => total + item.amount, 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  $('#category-trend').innerHTML = total
    ? lineChart(values, values.map((_, index) => `T${index + 1}`), '#c96787', `Xu hướng ${categoryById(selectedTrendCategory)?.name || 'danh mục đã xóa'} năm ${selectedYear}, tổng ${money(total)}`, values.flatMap((value, index) => value ? [index] : []))
    : '<div class="empty-state"><strong>Chưa có khoản chi cho danh mục này</strong>Chọn danh mục khác hoặc thêm giao dịch trong năm.</div>';
  $('#category-trend-caption').textContent = total ? `Tổng ${money(total)} trong năm ${selectedYear}` : '';
}

function renderCashflow() {
  const [year, month] = selectedMonth.split('-').map(Number);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(year, month - 6 + index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const items = monthlyTransactions(key);
    return { label: `T${date.getMonth() + 1}`, income: sum(items.filter((item) => item.type === 'income')), expense: sum(items.filter((item) => item.type === 'expense')) };
  });
  const max = Math.max(1, ...months.flatMap((item) => [item.income, item.expense]));
  $('#cashflow-chart').innerHTML = months.map((item) => `<div class="chart-col"><div class="bar-area"><div class="bar income" style="height:${item.income ? Math.max(4, item.income / max * 100) : 0}%" title="Thu: ${money(item.income)}"></div><div class="bar expense" style="height:${item.expense ? Math.max(4, item.expense / max * 100) : 0}%" title="Chi: ${money(item.expense)}"></div></div><span class="chart-label">${item.label}</span></div>`).join('');
  $('#cashflow-chart').setAttribute('aria-label', `Biểu đồ thu chi sáu tháng, cao nhất ${money(max)}`);
}

function renderCategoryChart(expenseItems) {
  const total = sum(expenseItems);
  if (!total) { $('#category-chart').innerHTML = '<div class="empty-state"><strong>Chưa có khoản chi</strong>Ghi giao dịch đầu tiên để xem chi tiêu theo danh mục.</div>'; return; }
  const grouped = Object.entries(expenseItems.reduce((map, item) => { map[item.categoryId] = (map[item.categoryId] || 0) + item.amount; return map; }, {})).sort((a, b) => b[1] - a[1]);
  let position = 0;
  const stops = grouped.map(([, amount], index) => { const start = position; position += amount / total * 100; return `${palette[index % palette.length]} ${start}% ${position}%`; });
  const legend = grouped.map(([id, amount], index) => `<div class="category-legend-row"><span class="legend-name"><i style="background:${palette[index % palette.length]}"></i>${escapeHtml(categoryById(id)?.name || 'Danh mục đã xóa')}</span><strong>${Math.round(amount / total * 100)}%</strong></div>`).join('');
  $('#category-chart').innerHTML = `<div class="donut" style="background:conic-gradient(${stops.join(',')})"><div class="donut-hole"><small>Tổng chi</small><strong>${compactMoney(total)}</strong></div></div><div class="category-legend">${legend}</div>`;
}

function progressHtml(spent, limit) {
  if (!limit) return '<div class="budget-empty"><strong>Chưa đặt ngân sách</strong>Hãy đặt một giới hạn để bắt đầu theo dõi.</div>';
  const percent = Math.round(spent / limit * 100);
  const color = percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : '';
  return `<div class="budget-overview-top"><strong>${money(spent)}</strong><span>/ ${money(limit)}</span></div><div class="progress-track" role="progressbar" aria-valuenow="${spent}" aria-valuemin="0" aria-valuemax="${limit}" aria-label="Đã dùng ngân sách"><div class="progress-fill ${color}" style="width:${Math.min(percent, 100)}%"></div></div><div class="budget-caption"><span>Đã sử dụng ${percent}% ngân sách</span><strong>${spent > limit ? `Vượt ${money(spent - limit)}` : `Còn ${money(limit - spent)}`}</strong></div>`;
}

function renderOverviewBudget(expense) { $('#overview-budget').innerHTML = progressHtml(expense, Number(budgetForMonth().total) || 0); }

function transactionHtml(item, actions = false) {
  const category = categoryById(item.categoryId);
  const detail = [category?.name || 'Danh mục đã xóa', dateName(item.date)].join(' · ');
  const savedAsTemplate = state.templates.some((template) => template.type === item.type && template.amount === item.amount && template.categoryId === item.categoryId && template.note === (item.note || ''));
  const saveButton = savedAsTemplate
    ? `<span class="template-saved" aria-label="Đã lưu làm mẫu nhanh" title="Đã lưu làm mẫu nhanh">${iconSvg('star')}<span>Mẫu</span></span>`
    : `<button class="template-save-button" data-save-template="${escapeHtml(item.id)}" aria-label="Lưu giao dịch thành mẫu nhanh" title="Lưu thành mẫu nhanh">${iconSvg('star')}<span>Mẫu</span></button>`;
  return `<div class="${actions ? 'transaction-item' : 'recent-item'}"><span class="category-badge ${item.type === 'income' ? 'income' : ''}" aria-hidden="true">${categoryIconHtml(category?.icon, category?.id)}</span><div class="transaction-info"><strong>${escapeHtml(item.note || category?.name || 'Giao dịch')}</strong><span>${escapeHtml(detail)}</span></div><strong class="transaction-amount ${item.type}">${item.type === 'income' ? '+' : '−'}${money(item.amount)}</strong>${actions ? `<div class="transaction-actions">${saveButton}<button class="icon-action" data-edit-transaction="${escapeHtml(item.id)}" aria-label="Sửa giao dịch">${iconSvg('edit')}</button><button class="icon-action" data-delete-transaction="${escapeHtml(item.id)}" aria-label="Xóa giao dịch">${iconSvg('close')}</button></div>` : saveButton}</div>`;
}

function renderRecent(items) {
  const recent = sorted(items).slice(0, 4);
  $('#recent-transactions').innerHTML = recent.length ? recent.map((item) => transactionHtml(item)).join('') : '<div class="empty-state"><strong>Chưa có giao dịch</strong>Bắt đầu bằng một khoản thu hoặc chi hôm nay.</div>';
}

function renderTransactionFilters() {
  const select = $('#category-filter');
  const previous = select.value;
  select.innerHTML = '<option value="all">Tất cả danh mục</option>' + state.categories.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  select.value = state.categories.some((item) => item.id === previous) ? previous : 'all';
}

function filteredTransactions() {
  return sorted(filterTransactions(state, {
    query: $('#search-input').value,
    type: $('#type-filter').value,
    category: $('#category-filter').value,
    period: $('#period-filter').value,
    month: selectedMonth,
    from: $('#date-from').value,
    to: $('#date-to').value,
  }));
}

function renderTransactions() {
  const items = filteredTransactions();
  $('#transaction-count').textContent = `${items.length} giao dịch`;
  $('#transaction-period-caption').textContent = $('#period-filter').value === 'month' ? monthName(selectedMonth) : $('#period-filter').value === 'range' ? 'Trong khoảng ngày' : 'Mọi thời gian';
  $('#transaction-list').innerHTML = items.length ? items.map((item) => transactionHtml(item, true)).join('') : '<div class="empty-state"><strong>Không tìm thấy giao dịch</strong>Thử đổi bộ lọc hoặc thêm giao dịch mới.</div>';
}

function renderBudgets(expense) {
  const budget = budgetForMonth();
  $('#total-budget-input').value = budget.total || '';
  $('#total-budget-progress').innerHTML = budget.total ? `<div class="budget-stats"><div>Đã chi<strong>${money(expense)}</strong></div><div>${expense > budget.total ? 'Đã vượt' : 'Còn lại'}<strong>${money(Math.abs(budget.total - expense))}</strong></div></div><div class="progress-track"><div class="progress-fill ${expense >= budget.total ? 'danger' : expense >= budget.total * .8 ? 'warning' : ''}" style="width:${Math.min(expense / budget.total * 100, 100)}%"></div></div>` : '';
  const expenses = state.categories.filter((item) => item.type === 'expense');
  $('#category-budgets').innerHTML = expenses.map((category) => {
    const spent = sum(monthlyTransactions().filter((item) => item.type === 'expense' && item.categoryId === category.id));
    const limit = Number(budget.categories?.[category.id]) || 0;
    const percentage = limit ? Math.round(spent / limit * 100) : 0;
    return `<div class="category-budget-row"><div class="budget-row-name"><span class="category-badge">${categoryIconHtml(category.icon, category.id)}</span><strong>${escapeHtml(category.name)}</strong></div><div class="budget-mini"><span>${money(spent)}${limit ? ` / ${money(limit)} · ${percentage}%` : ' đã chi'}</span><div class="progress-track"><div class="progress-fill ${percentage >= 100 ? 'danger' : percentage >= 80 ? 'warning' : ''}" style="width:${Math.min(percentage, 100)}%"></div></div></div><div class="budget-input-wrap"><input type="number" min="0" step="1000" inputmode="numeric" value="${limit || ''}" data-budget-input="${escapeHtml(category.id)}" aria-label="Ngân sách ${escapeHtml(category.name)}" placeholder="Chưa đặt" /><button data-save-budget="${escapeHtml(category.id)}" aria-label="Lưu ngân sách ${escapeHtml(category.name)}">${iconSvg('check')}</button></div></div>`;
  }).join('');
  const rows = budgetComparison(state, selectedMonth);
  $('#budget-comparison').innerHTML = rows.length ? rows.map((row) => {
    const scale = Math.max(row.limit, row.spent);
    const name = row.id === null ? 'Tổng ngân sách' : categoryById(row.id)?.name || 'Danh mục đã xóa';
    return `<div class="budget-compare-row"><div class="budget-compare-heading"><strong>${escapeHtml(name)}</strong><span>${Math.round(row.spent / row.limit * 100)}% · ${row.spent > row.limit ? `Vượt ${money(row.spent - row.limit)}` : `Còn ${money(row.limit - row.spent)}`}</span></div><div class="budget-compare-bar"><span class="budget-compare-limit" style="width:${row.limit / scale * 100}%" title="Ngân sách: ${money(row.limit)}"></span><span class="budget-compare-spent" style="width:${row.spent / scale * 100}%" title="Đã chi: ${money(row.spent)}"></span></div><div class="budget-compare-values"><span>Ngân sách ${money(row.limit)}</span><span>Đã chi ${money(row.spent)}</span></div></div>`;
  }).join('') : '<div class="empty-state"><strong>Chưa đặt ngân sách</strong>Đặt ngân sách tổng hoặc theo danh mục để xem so sánh.</div>';
}

function renderCategories() {
  for (const type of ['expense', 'income']) {
    const categories = state.categories.filter((item) => item.type === type);
    $(`#${type}-categories`).innerHTML = categories.length ? categories.map((item) => {
      const count = state.transactions.filter((transaction) => transaction.categoryId === item.id).length;
      return `<div class="category-row"><span class="category-badge ${type === 'income' ? 'income' : ''}">${categoryIconHtml(item.icon, item.id)}</span><strong>${escapeHtml(item.name)}</strong><small>${count} giao dịch</small><button class="icon-action" data-edit-category="${escapeHtml(item.id)}" aria-label="Sửa ${escapeHtml(item.name)}">${iconSvg('edit')}</button><button class="icon-action" data-delete-category="${escapeHtml(item.id)}" aria-label="Xóa ${escapeHtml(item.name)}">${iconSvg('close')}</button></div>`;
    }).join('') : '<div class="empty-state">Chưa có danh mục.</div>';
  }
}

function renderBudgetAlerts() {
  const alerts = budgetAlerts(state, selectedMonth);
  const html = alerts.map((alert) => {
    const name = alert.scope === 'total' ? 'Tổng ngân sách' : categoryById(alert.categoryId)?.name || 'Danh mục đã xóa';
    const detail = alert.spent >= alert.limit ? `Vượt ${money(alert.spent - alert.limit)}` : `Đã dùng ${alert.percent}% giới hạn ${money(alert.limit)}`;
    return `<div class="budget-alert ${alert.level}"><strong>${alert.level === 'danger' ? 'Đã chạm hoặc vượt mức' : 'Sắp chạm mức'} · ${escapeHtml(name)}</strong>${detail}</div>`;
  });
  $('#overview-budget-alerts').innerHTML = html.slice(0, 2).join('');
  $('#budget-alerts-detail').innerHTML = html.join('');
}

function renderTemplates() {
  const items = state.templates.filter((item) => categoryById(item.categoryId)?.type === item.type);
  const chip = (item, canDelete) => `<div class="template-item"><button data-use-template="${escapeHtml(item.id)}" title="Dùng mẫu ${escapeHtml(item.name)}">${escapeHtml(item.name)}<small>${money(item.amount)}</small></button>${canDelete ? `<button class="icon-action" data-delete-template="${escapeHtml(item.id)}" aria-label="Xóa mẫu ${escapeHtml(item.name)}">×</button>` : ''}</div>`;
  $('#overview-template-list').innerHTML = items.length ? items.slice(0, 6).map((item) => chip(item, false)).join('') : '<p class="helper-empty">Khi thêm giao dịch, chọn “Lưu làm mẫu nhanh” để dùng lại lần sau.</p>';
  $('#template-list').innerHTML = items.length ? items.map((item) => chip(item, true)).join('') : '<p class="helper-empty">Chọn “Lưu làm mẫu nhanh” khi thêm giao dịch, hoặc bấm ☆ Mẫu ở giao dịch đã có.</p>';
}

function renderRecurring() {
  const due = dueRecurring(state, selectedMonth, todayLocal()).filter(({ rule }) => categoryById(rule.categoryId)?.type === rule.type);
  $('#overview-recurring-due').innerHTML = due.length ? `<div class="recurring-notice"><strong>${due.length} khoản định kỳ đến hạn trong ${monthName(selectedMonth)}</strong><button class="text-link" data-view="transactions">Xem và xác nhận →</button></div>` : '';
  $('#recurring-due').innerHTML = due.map(({ rule, occurrence }) => `<div class="recurring-due"><div><strong>Đến hạn: ${escapeHtml(rule.name)} · ${money(occurrence.amount)}</strong><small>${dateName(occurrence.date)} · Chưa ghi vào sổ</small></div><button class="button button-primary" data-confirm-recurring="${escapeHtml(rule.id)}">Xác nhận</button><button class="button button-outline" data-skip-recurring="${escapeHtml(rule.id)}">Bỏ qua tháng này</button></div>`).join('');
  $('#recurring-list').innerHTML = state.recurring.length ? state.recurring.map((rule) => `<div class="recurring-row"><div><strong>${escapeHtml(rule.name)} · ${money(rule.amount)}</strong><small>Ngày ${rule.day} hằng tháng · từ ${monthName(rule.startMonth)}${(rule.skippedMonths || []).includes(selectedMonth) ? ' · Đã bỏ qua tháng này' : ''}</small></div>${(rule.skippedMonths || []).includes(selectedMonth) ? `<button class="text-link" data-unskip-recurring="${escapeHtml(rule.id)}">Hoàn tác bỏ qua</button>` : ''}<button class="icon-action" data-edit-recurring="${escapeHtml(rule.id)}" aria-label="Sửa ${escapeHtml(rule.name)}">${iconSvg('edit')}</button><button class="icon-action" data-delete-recurring="${escapeHtml(rule.id)}" aria-label="Xóa ${escapeHtml(rule.name)}">${iconSvg('close')}</button></div>`).join('') : '<p class="helper-empty">Chưa có khoản định kỳ. Tạo khoản như lương hoặc tiền thuê nhà để app nhắc xác nhận mỗi tháng.</p>';
}

function populateTransactionCategories(type, selectedId = '') {
  const options = state.categories.filter((item) => item.type === type);
  $('#transaction-category').innerHTML = options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (options.some((item) => item.id === selectedId)) $('#transaction-category').value = selectedId;
}

function setTransactionType(type, selectedId = '') {
  $('#transaction-type').value = type;
  $$('[data-transaction-type]').forEach((button) => button.classList.toggle('active', button.dataset.transactionType === type));
  populateTransactionCategories(type, selectedId);
}

function openTransaction(id = '', preset = null) {
  $('#transaction-form').reset();
  $('#transaction-id').value = id;
  $('#transaction-date').value = selectedMonth === currentMonth() ? todayLocal() : `${selectedMonth}-01`;
  const item = state.transactions.find((transaction) => transaction.id === id);
  $('#transaction-dialog-title').textContent = item ? 'Sửa giao dịch' : preset ? 'Xác nhận giao dịch' : 'Thêm giao dịch';
  setTransactionType(item?.type || preset?.type || 'expense', item?.categoryId || preset?.categoryId);
  const source = item || preset;
  if (source) { $('#transaction-amount').value = formatAmountInput(source.amount); $('#transaction-date').value = source.date || todayLocal(); $('#transaction-note').value = source.note || ''; }
  $('#transaction-dialog').showModal();
  $('#transaction-amount').focus();
}

function renderCategoryIconPicker() {
  const type = $('#category-type').value;
  const value = $('#category-icon').value;
  const categoryId = $('#category-id').value;
  const selected = categoryIconValue(value, categoryId);
  const options = categoryIconsForType(type);
  const selectedIndex = options.findIndex((option) => option.value === selected);
  if (selectedIndex > 0) options.unshift(options.splice(selectedIndex, 1)[0]);
  else if (selectedIndex < 0) {
    options.unshift(CATEGORY_ICON_OPTIONS.find((option) => option.value === selected) || { value, label: 'Đang dùng', symbol: null });
  }
  $('#category-icon-picker').innerHTML = options.map((option) => {
    const active = option.value === selected;
    return `<button type="button" class="category-icon-choice${active ? ' active' : ''}" data-category-icon="${escapeHtml(option.value)}" aria-label="${escapeHtml(option.label)}" aria-pressed="${active}"><span class="category-badge ${type === 'income' ? 'income' : ''}" aria-hidden="true">${option.symbol ? iconSvg(option.symbol) : categoryIconHtml(option.value, categoryId)}</span><span>${escapeHtml(option.label)}</span></button>`;
  }).join('');
}

function openCategory(id = '') {
  $('#category-form').reset();
  $('#category-id').value = id;
  const category = categoryById(id);
  $('#category-dialog-title').textContent = category ? 'Sửa danh mục' : 'Thêm danh mục';
  $('#category-name').value = category?.name || '';
  $('#category-type').value = category?.type || 'expense';
  $('#category-icon').value = category?.icon || 'other';
  $('#category-type').disabled = !!category && [...state.transactions, ...state.templates, ...state.recurring].some((item) => item.categoryId === id);
  renderCategoryIconPicker();
  $('#category-dialog').showModal();
  $('#category-name').focus();
}

function downloadFile(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  downloadFile(createBackup(state), `moneynote-sao-luu-${todayLocal()}.json`, 'application/json;charset=utf-8');
  toast('Đã sao lưu toàn bộ dữ liệu');
}

function populateRecurringCategories(type, selectedId = '') {
  const options = state.categories.filter((item) => item.type === type);
  $('#recurring-category').innerHTML = options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (options.some((item) => item.id === selectedId)) $('#recurring-category').value = selectedId;
}

function openRecurring(id = '') {
  $('#recurring-form').reset();
  const rule = state.recurring.find((item) => item.id === id);
  $('#recurring-id').value = id;
  $('#recurring-dialog-title').textContent = rule ? 'Sửa khoản định kỳ' : 'Tạo khoản định kỳ';
  $('#recurring-name').value = rule?.name || '';
  $('#recurring-type').value = rule?.type || 'expense';
  populateRecurringCategories($('#recurring-type').value, rule?.categoryId);
  $('#recurring-amount').value = rule ? formatAmountInput(rule.amount) : '';
  $('#recurring-day').value = rule?.day || new Date().getDate();
  $('#recurring-start').value = rule?.startMonth || currentMonth();
  $('#recurring-note').value = rule?.note || '';
  $('#recurring-dialog').showModal();
  $('#recurring-name').focus();
}

function addTemplateFromTransaction(transaction) {
  const duplicate = state.templates.some((item) => item.type === transaction.type && item.amount === transaction.amount && item.categoryId === transaction.categoryId && item.note === (transaction.note || ''));
  if (duplicate) return false;
  state.templates.push({ id: uid(), name: (transaction.note || categoryById(transaction.categoryId)?.name || 'Giao dịch').slice(0, 60), type: transaction.type, amount: transaction.amount, categoryId: transaction.categoryId, note: transaction.note || '' });
  return true;
}

function saveTemplate(transaction) {
  if (!addTemplateFromTransaction(transaction)) { toast('Giao dịch này đã có mẫu nhanh'); return; }
  saveState(); render(); toast('Đã lưu mẫu nhanh');
}

function conflictDescription(row) {
  if (!row) return 'Mục chưa có trên đám mây';
  if (row.deleted) return 'Mục đã bị xóa';
  const item = row.payload || {};
  if (row.kind === 'budget_total') return `Ngân sách ${monthName(row.record_id)}\nGiới hạn: ${money(item.amount)}`;
  if (row.kind === 'category_budget') return `Ngân sách danh mục: ${categoryById(item.categoryId)?.name || item.categoryId}\n${monthName(item.month)} · ${money(item.amount)}`;
  const lines = [item.name || (row.kind === 'transaction' ? 'Giao dịch' : row.record_id)];
  if (item.type) lines.push(item.type === 'income' ? 'Khoản thu' : 'Khoản chi');
  if (Number.isSafeInteger(item.amount)) lines.push(`Số tiền: ${money(item.amount)}`);
  if (item.date) lines.push(`Ngày: ${dateName(item.date)}`);
  if (item.categoryId) lines.push(`Danh mục: ${categoryById(item.categoryId)?.name || item.categoryId}`);
  if (item.day) lines.push(`Ngày hằng tháng: ${item.day}`);
  if (item.startMonth) lines.push(`Từ ${monthName(item.startMonth)}`);
  if (item.note) lines.push(`Ghi chú: ${item.note}`);
  if (item.icon) lines.push(`Biểu tượng: ${item.icon}`);
  if (item.skippedMonths?.length) lines.push(`Đã bỏ qua: ${item.skippedMonths.join(', ')}`);
  return lines.join('\n');
}

function showConflicts(items) {
  if (!items.length) {
    deferredConflicts.clear();
    currentConflictKey = undefined;
    if ($('#conflict-dialog').open) $('#conflict-dialog').close();
    return;
  }
  if ($$('dialog[open]').some((dialog) => dialog.id !== 'conflict-dialog')) return;
  const next = items.find((item) => !deferredConflicts.has(item.key));
  if (!next) return;
  currentConflictKey = next.key;
  $('#conflict-local').textContent = conflictDescription(next.local);
  $('#conflict-remote').textContent = conflictDescription(next.remote);
  if (!$('#conflict-dialog').open) $('#conflict-dialog').showModal();
}

function exportCsv(items, filename) {
  const safeCell = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [['Ngày', 'Loại', 'Danh mục', 'Số tiền (VND)', 'Ghi chú'], ...sorted(items).map((item) => [item.date, item.type === 'income' ? 'Thu' : 'Chi', categoryById(item.categoryId)?.name || '', item.amount, item.note || ''])];
  const csv = '\ufeff' + rows.map((row) => row.map(safeCell).join(',')).join('\r\n');
  downloadFile(csv, filename, 'text/csv;charset=utf-8');
  toast(`Đã xuất ${items.length} giao dịch`);
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.view) setView(target.dataset.view);
  if (target.dataset.heatDate) {
    $('#search-input').value = '';
    $('#type-filter').value = 'all';
    $('#category-filter').value = 'all';
    $('#period-filter').value = 'range';
    $('#date-range-fields').hidden = false;
    $('#date-from').value = target.dataset.heatDate;
    $('#date-to').value = target.dataset.heatDate;
    renderTransactions();
    setView('transactions');
  }
  if (target.dataset.yearMonth) { selectedMonth = target.dataset.yearMonth; render(); setView('overview'); }
  if (target.hasAttribute('data-add')) openTransaction();
  if (target.hasAttribute('data-close')) target.closest('dialog').close();
  if (target.dataset.transactionType) setTransactionType(target.dataset.transactionType);
  if (target.dataset.editTransaction) openTransaction(target.dataset.editTransaction);
  if (target.dataset.saveTemplate) {
    const item = state.transactions.find((entry) => entry.id === target.dataset.saveTemplate);
    if (item) saveTemplate(item);
  }
  if (target.dataset.useTemplate) {
    const item = state.templates.find((entry) => entry.id === target.dataset.useTemplate);
    if (item) openTransaction('', { ...item, date: todayLocal() });
  }
  if (target.dataset.deleteTemplate) {
    const item = state.templates.find((entry) => entry.id === target.dataset.deleteTemplate);
    if (item && confirm(`Xóa mẫu "${item.name}"?`)) { state.templates = state.templates.filter((entry) => entry.id !== item.id); saveState(); render(); toast('Đã xóa mẫu'); }
  }
  if (target.id === 'add-recurring') openRecurring();
  if (target.dataset.editRecurring) openRecurring(target.dataset.editRecurring);
  if (target.dataset.deleteRecurring) {
    const rule = state.recurring.find((entry) => entry.id === target.dataset.deleteRecurring);
    if (rule && confirm(`Xóa khoản định kỳ "${rule.name}"? Các giao dịch đã xác nhận vẫn được giữ.`)) { state.recurring = state.recurring.filter((entry) => entry.id !== rule.id); saveState(); render(); toast('Đã xóa khoản định kỳ'); }
  }
  if (target.dataset.confirmRecurring) {
    const item = dueRecurring(state, selectedMonth, todayLocal()).find(({ rule }) => rule.id === target.dataset.confirmRecurring);
    if (item) openTransaction(item.occurrence.id, item.occurrence);
  }
  if (target.dataset.skipRecurring) {
    const rule = state.recurring.find((entry) => entry.id === target.dataset.skipRecurring);
    if (rule) { rule.skippedMonths ||= []; if (!rule.skippedMonths.includes(selectedMonth)) rule.skippedMonths.push(selectedMonth); saveState(); render(); toast('Đã bỏ qua khoản này trong tháng'); }
  }
  if (target.dataset.unskipRecurring) {
    const rule = state.recurring.find((entry) => entry.id === target.dataset.unskipRecurring);
    if (rule) { rule.skippedMonths = (rule.skippedMonths || []).filter((month) => month !== selectedMonth); saveState(); render(); toast('Đã hoàn tác bỏ qua'); }
  }
  if (target.dataset.deleteTransaction) {
    const item = state.transactions.find((entry) => entry.id === target.dataset.deleteTransaction);
    if (item && confirm(`Xóa giao dịch ${money(item.amount)}?`)) { state.transactions = state.transactions.filter((entry) => entry.id !== item.id); saveState(); render(); toast('Đã xóa giao dịch'); }
  }
  if (target.id === 'add-category') openCategory();
  if (target.dataset.editCategory) openCategory(target.dataset.editCategory);
  if (target.hasAttribute('data-category-icon')) {
    $('#category-icon').value = target.dataset.categoryIcon;
    $$('#category-icon-picker [data-category-icon]').forEach((button) => {
      const active = button === target;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  if (target.dataset.deleteCategory) {
    const id = target.dataset.deleteCategory, category = categoryById(id);
    if ([...state.transactions, ...state.templates, ...state.recurring].some((item) => item.categoryId === id)) { toast('Danh mục đang được dùng, không thể xóa'); return; }
    if (category && confirm(`Xóa danh mục "${category.name}"?`)) {
      state.categories = state.categories.filter((item) => item.id !== id);
      Object.values(state.budgets).forEach((budget) => { if (budget.categories) delete budget.categories[id]; });
      saveState(); render(); toast('Đã xóa danh mục');
    }
  }
  if (target.dataset.saveBudget) {
    const input = $$('[data-budget-input]').find((el) => el.dataset.budgetInput === target.dataset.saveBudget);
    const amount = amountInput(input.value || '0', true);
    if (amount === null) { toast('Ngân sách phải là số nguyên không âm'); input.focus(); return; }
    ensureBudget().categories[target.dataset.saveBudget] = amount;
    saveState(); render(); toast('Đã lưu ngân sách danh mục');
  }
  if (target.hasAttribute('data-backup')) exportBackup();
  if (target.hasAttribute('data-restore')) $('#backup-file').click();
  if (target.hasAttribute('data-sync-open')) { if (sync?.getConflicts().length) { deferredConflicts.clear(); showConflicts(sync.getConflicts()); } else { updateSyncDialog(); $('#sync-dialog').showModal(); } }
});

$('#backup-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Tệp sao lưu quá lớn (tối đa 10 MB)'); return; }
  try {
    pendingRestore = parseBackup(await file.text());
    const { transactions, categories, budgets, templates, recurring } = pendingRestore.data;
    const exportedAt = new Date(pendingRestore.exportedAt).toLocaleString('vi-VN');
    $('#restore-summary').textContent = `Bản sao lưu ngày ${exportedAt}: ${transactions.length} giao dịch, ${categories.length} danh mục, ${Object.keys(budgets).length} tháng ngân sách, ${templates.length} mẫu nhanh và ${recurring.length} khoản định kỳ.`;
    $('#restore-dialog .restore-warning').textContent = sync?.active
      ? 'Bản sao lưu sẽ thay thế dữ liệu trên thiết bị này và các mục thay đổi sẽ được đồng bộ lên đám mây. Hãy sao lưu dữ liệu hiện tại trước khi tiếp tục.'
      : 'Dữ liệu trên thiết bị này sẽ được thay thế. Hãy sao lưu dữ liệu hiện tại trước khi tiếp tục.';
    $('#restore-dialog').showModal();
  } catch (error) {
    pendingRestore = undefined;
    toast(error.message || 'Không thể đọc tệp sao lưu');
  }
});

$('#confirm-restore').addEventListener('click', () => {
  if (!pendingRestore) return;
  const previous = state;
  state = pendingRestore.data;
  if (!saveState()) { state = previous; toast('Không thể lưu bản khôi phục trên thiết bị này'); return; }
  pendingRestore = undefined;
  $('#restore-dialog').close();
  selectedMonth = state.transactions.length ? state.transactions.reduce((latest, item) => item.date > latest ? item.date : latest, '').slice(0, 7) : currentMonth();
  selectedYear = selectedMonth.slice(0, 4);
  $('#search-input').value = '';
  $('#type-filter').value = 'all';
  $('#category-filter').value = 'all';
  $('#period-filter').value = 'all';
  $('#date-range-fields').hidden = true;
  $('#date-from').value = '';
  $('#date-to').value = '';
  setView('overview');
  render();
  toast('Đã khôi phục toàn bộ dữ liệu');
});

$('#sync-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabaseClient) return;
  const button = $('#sync-login-button');
  button.disabled = true;
  try {
    const email = $('#sync-email').value.trim();
    const redirect = new URL(location.pathname, location.origin).href;
    const { error } = await supabaseClient.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    if (error) throw error;
    toast('Đã gửi liên kết đăng nhập. Hãy kiểm tra email.');
    $('#sync-dialog').close();
  } catch (error) { toast(`Không gửi được liên kết: ${error.message}`); }
  finally { button.disabled = false; }
});

$('#sync-refresh').addEventListener('click', () => { if (sync?.active) sync.syncNow(); else if (sessionUser) sync?.start(sessionUser.id); });
$('#sync-logout').addEventListener('click', async () => {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  if (error) { toast(`Không thể đăng xuất: ${error.message}`); return; }
  sync?.signOut();
  sessionUser = null;
  updateSyncDialog();
  toast('Đã đăng xuất; dữ liệu vẫn còn trên thiết bị này');
});

window.addEventListener('online', () => { if (sync?.active) sync.syncNow(); else if (sessionUser) sync?.start(sessionUser.id); });
window.addEventListener('offline', () => { if (sync?.active) setSyncStatus(`Ngoại tuyến${sync.queue.size ? ` · ${sync.queue.size} thay đổi chờ gửi` : ''}`); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (sync?.active) sync.syncNow(); else if (sessionUser && navigator.onLine) sync?.start(sessionUser.id); } });

$('#restore-dialog').addEventListener('close', () => { pendingRestore = undefined; });

$('#transaction-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const amount = amountInput(amountDigits($('#transaction-amount').value));
  const type = $('#transaction-type').value, categoryId = $('#transaction-category').value, date = $('#transaction-date').value;
  if (amount === null || !validDate(date) || categoryById(categoryId)?.type !== type) { toast('Kiểm tra lại số tiền, ngày và danh mục'); return; }
  const id = $('#transaction-id').value;
  const existing = state.transactions.find((item) => item.id === id);
  const next = { id: existing?.id || id || uid(), type, amount, categoryId, date, note: $('#transaction-note').value.trim(), createdAt: existing?.createdAt || new Date().toISOString() };
  if (existing) Object.assign(existing, next); else state.transactions.push(next);
  const wantedTemplate = $('#transaction-save-template').checked;
  const templateAdded = wantedTemplate && addTemplateFromTransaction(next);
  $('#transaction-dialog').close(); selectedMonth = date.slice(0, 7); selectedYear = date.slice(0, 4); saveState(); render();
  toast(wantedTemplate ? templateAdded ? 'Đã lưu giao dịch và mẫu nhanh' : 'Đã lưu giao dịch; mẫu này đã tồn tại' : existing ? 'Đã cập nhật giao dịch' : 'Đã thêm giao dịch');
});

function onAmountInput(event) {
  const input = event.currentTarget;
  const before = input.value;
  const digits = before.replace(/\D/g, '');
  const removedZeros = digits.length - amountDigits(before).length;
  const digitsBeforeCaret = before.slice(0, input.selectionStart ?? before.length).replace(/\D/g, '').length;
  const desiredDigit = Math.max(0, digitsBeforeCaret - removedZeros);
  const formatted = formatAmountInput(before);
  input.value = formatted;
  let caret = 0, seenDigits = 0;
  while (caret < formatted.length && seenDigits < desiredDigit) {
    if (/\d/.test(formatted[caret])) seenDigits++;
    caret++;
  }
  input.setSelectionRange(caret, caret);
}
for (const selector of ['#transaction-amount', '#recurring-amount']) $(selector).addEventListener('input', onAmountInput);

$('#recurring-type').addEventListener('change', (event) => populateRecurringCategories(event.target.value));
$('#recurring-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = $('#recurring-id').value;
  const existing = state.recurring.find((item) => item.id === id);
  const name = $('#recurring-name').value.trim();
  const type = $('#recurring-type').value;
  const categoryId = $('#recurring-category').value;
  const amount = amountInput(amountDigits($('#recurring-amount').value));
  const day = Number($('#recurring-day').value);
  const startMonth = $('#recurring-start').value;
  const note = $('#recurring-note').value.trim();
  if (!name || amount === null || !Number.isInteger(day) || day < 1 || day > 31 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) || categoryById(categoryId)?.type !== type) { toast('Kiểm tra lại khoản định kỳ'); return; }
  const next = { id: existing?.id || uid(), name, type, categoryId, amount, day, startMonth, note, skippedMonths: existing?.skippedMonths || [] };
  if (existing) Object.assign(existing, next); else state.recurring.push(next);
  $('#recurring-dialog').close(); saveState(); render(); toast(existing ? 'Đã sửa khoản định kỳ' : 'Đã tạo khoản định kỳ');
});

$('#conflict-later').addEventListener('click', () => {
  if (currentConflictKey) deferredConflicts.add(currentConflictKey);
  $('#conflict-dialog').close();
  showConflicts(sync?.getConflicts() || []);
});
for (const [selector, choice] of [['#conflict-use-local', 'local'], ['#conflict-use-remote', 'remote']]) {
  $(selector).addEventListener('click', () => {
    if (!currentConflictKey) return;
    const key = currentConflictKey;
    $('#conflict-dialog').close();
    deferredConflicts.delete(key);
    currentConflictKey = undefined;
    sync.resolveConflict(key, choice);
  });
}

$('#category-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#category-name').value.trim(), type = $('#category-type').value, icon = $('#category-icon').value;
  const id = $('#category-id').value, existing = categoryById(id);
  if (!name || !['income', 'expense'].includes(type)) return;
  if (state.categories.some((item) => item.id !== id && item.type === type && item.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) { toast('Danh mục này đã tồn tại'); return; }
  if (existing) Object.assign(existing, { name, type, icon }); else state.categories.push({ id: uid(), name, type, icon });
  $('#category-dialog').close(); saveState(); render(); toast(existing ? 'Đã sửa danh mục' : 'Đã thêm danh mục');
});
$('#category-type').addEventListener('change', (event) => {
  $('#category-icon').value = event.target.value === 'income' ? 'coins' : 'other';
  renderCategoryIconPicker();
});

$('#total-budget-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const amount = amountInput($('#total-budget-input').value || '0', true);
  if (amount === null) { toast('Ngân sách phải là số nguyên không âm'); return; }
  ensureBudget().total = amount; saveState(); render(); toast('Đã lưu ngân sách tháng');
});

$('#month-input').addEventListener('change', (event) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) return;
  selectedMonth = event.target.value; selectedYear = selectedMonth.slice(0, 4); render();
});
$('#year-input').addEventListener('change', (event) => { selectedYear = event.target.value; renderYearly(); });
$('#trend-category').addEventListener('change', (event) => { selectedTrendCategory = event.target.value; renderCategoryTrend(annualReport(state, selectedYear)); });
for (const selector of ['#search-input', '#type-filter', '#category-filter']) $(selector).addEventListener(selector === '#search-input' ? 'input' : 'change', renderTransactions);
$('#period-filter').addEventListener('change', (event) => { $('#date-range-fields').hidden = event.target.value !== 'range'; renderTransactions(); });
for (const selector of ['#date-from', '#date-to']) $(selector).addEventListener('change', renderTransactions);
$('#sidebar-export').addEventListener('click', () => exportCsv(state.transactions, `moneynote-tat-ca-${todayLocal()}.csv`));
$('#export-all').addEventListener('click', () => exportCsv(state.transactions, `moneynote-tat-ca-${todayLocal()}.csv`));
$('#export-filtered').addEventListener('click', () => exportCsv(filteredTransactions(), `moneynote-${selectedMonth}.csv`));
$('#export-year').addEventListener('click', () => exportCsv(annualReport(state, selectedYear).transactions, `moneynote-${selectedYear}.csv`));
for (const dialog of $$('dialog')) dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
window.addEventListener('hashchange', () => setView(location.hash.slice(1)));

$$('[data-app-version]').forEach((element) => { element.textContent = `v${APP_VERSION}`; });
setView(location.hash.slice(1) || 'overview');
render();
initializeSync();
window.addEventListener('load', () => {
  if (location.hash) window.scrollTo(0, 0);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
});
