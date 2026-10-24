import { createBackup, parseBackup } from './backup.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './sync-config.js';
import { MoneyNoteSync, diffRecords, LOCAL_DIRTY_KEY } from './sync.js';
import { annualCategorySeries, annualReport, budgetAlerts, budgetComparison, dueRecurring, filterTransactions, monthlyExpenseDays } from './features.js';
import { CATEGORY_ICON_OPTIONS, categoryIconSymbol, categoryIconValue, categoryIconsForType } from './category-icons.js';
import { APP_VERSION } from './version.js';
import { DEFAULT_ACCOUNT, accountBalance, annualBudgetStatus, effectiveMonthlyBudget } from './finance.js';
import { parseCsv, prepareCsvImport } from './csv-import.js';

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
    const accounts = Array.isArray(saved.accounts) ? saved.accounts.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isSafeInteger(item.openingBalance)) : [];
    if ((saved.transactions.some((item) => item && (!item.accountId || item.accountId === DEFAULT_ACCOUNT.id)) || saved.transfers?.some((item) => item?.fromAccountId === DEFAULT_ACCOUNT.id || item?.toAccountId === DEFAULT_ACCOUNT.id)) && !accounts.some((item) => item.id === DEFAULT_ACCOUNT.id)) accounts.unshift(structuredClone(DEFAULT_ACCOUNT));
    return {
      transactions: saved.transactions.filter((item) => item && typeof item.id === 'string' && ['income', 'expense'].includes(item.type) && Number.isSafeInteger(item.amount) && item.amount > 0 && validDate(item.date)),
      categories: saved.categories.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && ['income', 'expense'].includes(item.type)),
      budgets: saved.budgets && typeof saved.budgets === 'object' ? saved.budgets : {},
      templates: Array.isArray(saved.templates) ? saved.templates.filter((item) => item && typeof item.id === 'string' && Number.isSafeInteger(item.amount) && item.amount > 0 && ['income', 'expense'].includes(item.type)) : [],
      recurring: Array.isArray(saved.recurring) ? saved.recurring.filter((item) => item && typeof item.id === 'string' && Number.isSafeInteger(item.amount) && item.amount > 0 && Number.isInteger(item.day) && item.day >= 1 && item.day <= 31 && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.startMonth)) : [],
      accounts: accounts.length ? accounts : [structuredClone(DEFAULT_ACCOUNT)],
      transfers: Array.isArray(saved.transfers) ? saved.transfers.filter((item) => item && typeof item.id === 'string' && Number.isSafeInteger(item.amount) && item.amount > 0 && validDate(item.date) && typeof item.fromAccountId === 'string' && typeof item.toAccountId === 'string' && item.fromAccountId !== item.toAccountId) : [],
      goals: Array.isArray(saved.goals) ? saved.goals.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isSafeInteger(item.targetAmount) && item.targetAmount > 0 && Number.isSafeInteger(item.savedAmount) && item.savedAmount >= 0) : [],
      annualBudgets: saved.annualBudgets && typeof saved.annualBudgets === 'object' && !Array.isArray(saved.annualBudgets) ? saved.annualBudgets : {},
    };
  } catch {
    return { transactions: [], categories: structuredClone(defaultCategories), budgets: {}, templates: [], recurring: [], accounts: [structuredClone(DEFAULT_ACCOUNT)], transfers: [], goals: [], annualBudgets: {} };
  }
}

let state = loadState();
let lastSavedState = structuredClone(state);
let selectedMonth = currentMonth();
let selectedYear = selectedMonth.slice(0, 4);
let selectedTrendCategory = '';
let activeView = 'overview';
let toastTimer;
let undoTimer;
let undoDeleteAction;
let pendingRestore;
let csvSource;
let csvPreview = [];
let csvSelection = new Set();
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
  renderSyncDetail();
}

function renderSyncDetail() {
  const info = sync?.getDiagnostics();
  if (!info || !sync.active) { $('#sync-detail').textContent = 'Dữ liệu đang lưu trên thiết bị. Khi đăng nhập, app sẽ gửi từng thay đổi lên đám mây.'; return; }
  const last = info.lastSyncedAt ? new Date(info.lastSyncedAt).toLocaleString('vi-VN') : 'chưa có';
  $('#sync-detail').textContent = `Chờ gửi: ${info.queued} · Xung đột: ${info.conflicts} · Đồng bộ thành công gần nhất: ${last}${info.lastError ? ` · Lỗi gần nhất: ${info.lastError}` : ''}`;
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
  renderSyncDetail();
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

function toast(message, duration = 3200) {
  const el = $('#toast'); $('#toast-message').textContent = message; $('#undo-delete').hidden = !undoDeleteAction; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function deletedWithUndo(message, restore) {
  undoDeleteAction = restore;
  clearTimeout(undoTimer);
  saveState(); render(); toast(message, 8000);
  undoTimer = setTimeout(() => { undoDeleteAction = undefined; $('#undo-delete').hidden = true; }, 8000);
}

function categoryById(id) { return state.categories.find((item) => item.id === id); }
function accountById(id) { return state.accounts.find((item) => item.id === (id || DEFAULT_ACCOUNT.id)); }
function monthlyTransactions(month = selectedMonth) { return state.transactions.filter((item) => item.date.slice(0, 7) === month); }
function sorted(items) { return [...items].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')); }
function budgetForMonth() {
  const entry = state.budgets[selectedMonth];
  return entry && typeof entry === 'object' ? entry : { total: 0, categories: {}, rollover: false };
}
function ensureBudget() {
  if (!state.budgets[selectedMonth] || typeof state.budgets[selectedMonth] !== 'object') state.budgets[selectedMonth] = { total: 0, categories: {}, rollover: false };
  if (!state.budgets[selectedMonth].categories || typeof state.budgets[selectedMonth].categories !== 'object') state.budgets[selectedMonth].categories = {};
  return state.budgets[selectedMonth];
}
function amountInput(value, allowZero = false) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= (allowZero ? 0 : 1) && amount <= 999999999999 ? amount : null;
}

function setView(view) {
  if (!['overview', 'transactions', 'budgets', 'yearly', 'categories', 'wallets'].includes(view)) return;
  activeView = view;
  document.body.classList.toggle('yearly-view', view === 'yearly');
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === view));
  $$('[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $('#breadcrumb-current').textContent = { overview: 'Tổng quan', transactions: 'Giao dịch', budgets: 'Ngân sách', yearly: 'Theo năm', categories: 'Danh mục', wallets: 'Ví & mục tiêu' }[view];
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
  renderWallets();
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
  const currentYear = Number(currentMonth().slice(0, 4));
  const years = [...new Set([selectedYear, String(currentYear - 1), String(currentYear), String(currentYear + 1), ...Object.keys(state.annualBudgets), ...state.transactions.map((item) => item.date.slice(0, 4))])].sort((a, b) => b.localeCompare(a));
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
  const annualBudget = annualBudgetStatus(state, selectedYear);
  $('#annual-budget-year').textContent = selectedYear;
  $('#annual-budget-input').value = annualBudget.limit || '';
  $('#annual-budget-progress').innerHTML = annualBudget.limit ? progressHtml(annualBudget.spent, annualBudget.limit) : '<div class="budget-empty"><strong>Chưa đặt giới hạn năm</strong>Nhập số tiền dự định chi trong năm để theo dõi.</div>';

  const max = Math.max(1, ...report.months.flatMap((month) => [month.income, month.expense]));
  $('#yearly-chart').innerHTML = report.months.map((month) => `<button class="yearly-chart-col" data-drill-month="${selectedYear}-${String(month.number).padStart(2, '0')}" aria-label="Xem giao dịch tháng ${month.number}/${selectedYear}"><span class="yearly-bar-area"><span class="yearly-bar income" style="height:${month.income ? Math.max(3, month.income / max * 100) : 0}%" title="Tháng ${month.number}: thu ${money(month.income)}"></span><span class="yearly-bar expense" style="height:${month.expense ? Math.max(3, month.expense / max * 100) : 0}%" title="Tháng ${month.number}: chi ${money(month.expense)}"></span></span><span>T${month.number}</span></button>`).join('');
  $('#yearly-chart').setAttribute('aria-label', `Thu và chi theo 12 tháng năm ${selectedYear}. Tổng thu ${money(report.incomeTotal)}, tổng chi ${money(report.expenseTotal)}.`);

  $('#yearly-categories').innerHTML = report.categories.length
    ? report.categories.map(({ id, amount }, index) => {
      const category = categoryById(id);
      const percent = Math.round(amount / report.expenseTotal * 100);
      return `<button class="yearly-category-row" data-drill-year="${selectedYear}" data-drill-category="${escapeHtml(id)}" aria-label="Xem khoản chi ${escapeHtml(category?.name || 'danh mục đã xóa')} năm ${selectedYear}"><span class="category-badge">${categoryIconHtml(category?.icon, id)}</span><div class="yearly-category-info"><div><strong>${escapeHtml(category?.name || 'Danh mục đã xóa')}</strong><span>${percent}%</span></div><div class="yearly-category-track"><i style="width:${amount / report.expenseTotal * 100}%;background:${palette[index % palette.length]}"></i></div></div><strong class="yearly-category-amount">${money(amount)}</strong></button>`;
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
    ? `<div class="stacked-chart" role="group" aria-label="Chi tiêu theo danh mục của 12 tháng năm ${selectedYear}">${series.months.map((month) => {
      const total = month.segments.reduce((sum, item) => sum + item.amount, 0);
      const segments = month.segments.map((segment, index) => {
        if (!segment.amount) return '';
        const name = segment.id === null ? 'Danh mục khác' : categoryById(segment.id)?.name || 'Danh mục đã xóa';
        const style = `height:${segment.amount / total * 100}%;background:${palette[index % palette.length]}`;
        const title = `Tháng ${month.number} · ${name}: ${money(segment.amount)}`;
        return segment.id === null ? `<span style="${style}" title="${escapeHtml(title)}"></span>`
          : `<button data-drill-month="${selectedYear}-${String(month.number).padStart(2, '0')}" data-drill-category="${escapeHtml(segment.id)}" style="${style}" title="${escapeHtml(title)}" aria-label="Xem giao dịch tháng ${month.number} của ${escapeHtml(name)}"></button>`;
      }).join('');
      return `<div class="stacked-col"><div class="stacked-bar-area"><div class="stacked-bar" style="height:${total / max * 100}%">${segments}</div></div><span>T${month.number}</span></div>`;
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
    return { key, label: `T${date.getMonth() + 1}`, income: sum(items.filter((item) => item.type === 'income')), expense: sum(items.filter((item) => item.type === 'expense')) };
  });
  const max = Math.max(1, ...months.flatMap((item) => [item.income, item.expense]));
  $('#cashflow-chart').innerHTML = months.map((item) => `<button class="chart-col" data-drill-month="${item.key}" aria-label="Xem giao dịch ${monthName(item.key)}"><span class="bar-area"><span class="bar income" style="height:${item.income ? Math.max(4, item.income / max * 100) : 0}%" title="Thu: ${money(item.income)}"></span><span class="bar expense" style="height:${item.expense ? Math.max(4, item.expense / max * 100) : 0}%" title="Chi: ${money(item.expense)}"></span></span><span class="chart-label">${item.label}</span></button>`).join('');
  $('#cashflow-chart').setAttribute('aria-label', `Biểu đồ thu chi sáu tháng, cao nhất ${money(max)}`);
}

function renderCategoryChart(expenseItems) {
  const total = sum(expenseItems);
  if (!total) { $('#category-chart').innerHTML = '<div class="empty-state"><strong>Chưa có khoản chi</strong>Ghi giao dịch đầu tiên để xem chi tiêu theo danh mục.</div>'; return; }
  const grouped = Object.entries(expenseItems.reduce((map, item) => { map[item.categoryId] = (map[item.categoryId] || 0) + item.amount; return map; }, {})).sort((a, b) => b[1] - a[1]);
  let position = 0;
  const stops = grouped.map(([, amount], index) => { const start = position; position += amount / total * 100; return `${palette[index % palette.length]} ${start}% ${position}%`; });
  const legend = grouped.map(([id, amount], index) => `<button class="category-legend-row" data-drill-month="${selectedMonth}" data-drill-category="${escapeHtml(id)}" aria-label="Xem khoản chi ${escapeHtml(categoryById(id)?.name || 'danh mục đã xóa')} ${monthName(selectedMonth)}"><span class="legend-name"><i style="background:${palette[index % palette.length]}"></i>${escapeHtml(categoryById(id)?.name || 'Danh mục đã xóa')}</span><strong>${Math.round(amount / total * 100)}%</strong></button>`).join('');
  $('#category-chart').innerHTML = `<div class="donut" style="background:conic-gradient(${stops.join(',')})"><div class="donut-hole"><small>Tổng chi</small><strong>${compactMoney(total)}</strong></div></div><div class="category-legend">${legend}</div>`;
}

function progressHtml(spent, limit) {
  if (!limit) return '<div class="budget-empty"><strong>Chưa đặt ngân sách</strong>Hãy đặt một giới hạn để bắt đầu theo dõi.</div>';
  const percent = Math.round(spent / limit * 100);
  const color = percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : '';
  return `<div class="budget-overview-top"><strong>${money(spent)}</strong><span>/ ${money(limit)}</span></div><div class="progress-track" role="progressbar" aria-valuenow="${spent}" aria-valuemin="0" aria-valuemax="${limit}" aria-label="Đã dùng ngân sách"><div class="progress-fill ${color}" style="width:${Math.min(percent, 100)}%"></div></div><div class="budget-caption"><span>Đã sử dụng ${percent}% ngân sách</span><strong>${spent > limit ? `Vượt ${money(spent - limit)}` : `Còn ${money(limit - spent)}`}</strong></div>`;
}

function renderOverviewBudget(expense) { $('#overview-budget').innerHTML = progressHtml(expense, effectiveMonthlyBudget(state, selectedMonth).limit); }

function transactionHtml(item, actions = false) {
  const category = categoryById(item.categoryId);
  const detail = [category?.name || 'Danh mục đã xóa', accountById(item.accountId)?.name || 'Ví đã xóa', dateName(item.date)].join(' · ');
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
  const accountSelect = $('#account-filter'), accountPrevious = accountSelect.value;
  accountSelect.innerHTML = '<option value="all">Tất cả ví</option>' + state.accounts.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  accountSelect.value = state.accounts.some((item) => item.id === accountPrevious) ? accountPrevious : 'all';
}

function filteredTransactions() {
  return sorted(filterTransactions(state, {
    query: $('#search-input').value,
    type: $('#type-filter').value,
    category: $('#category-filter').value,
    account: $('#account-filter').value,
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
  const effective = effectiveMonthlyBudget(state, selectedMonth);
  $('#total-budget-input').value = budget.total || '';
  $('#budget-rollover').checked = !!budget.rollover;
  $('#total-budget-progress').innerHTML = effective.limit ? `<div class="budget-stats"><div>Đã chi<strong>${money(expense)}</strong></div><div>${expense > effective.limit ? 'Đã vượt' : 'Còn lại'}<strong>${money(Math.abs(effective.limit - expense))}</strong></div></div><div class="progress-track"><div class="progress-fill ${expense >= effective.limit ? 'danger' : expense >= effective.limit * .8 ? 'warning' : ''}" style="width:${Math.min(expense / effective.limit * 100, 100)}%"></div></div>` : '';
  $('#budget-rollover-caption').textContent = budget.rollover ? `Giới hạn gốc ${money(effective.base)} + chuyển dư ${money(effective.carry)} = ${money(effective.limit)}.` : 'Chuyển dư chỉ áp dụng cho tổng ngân sách tháng; cần đặt ngân sách ở tháng trước.';
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

function renderWallets() {
  const asOf = todayLocal();
  const total = state.accounts.reduce((amount, account) => amount + accountBalance(state, account.id, asOf), 0);
  $('#wallet-total-balance').textContent = money(total);
  $('#wallet-total-balance').classList.toggle('negative', total < 0);
  $('#account-list').innerHTML = state.accounts.map((account) => {
    const balance = accountBalance(state, account.id, asOf);
    return `<div class="wallet-row"><span class="wallet-row-icon">${iconSvg('wallet')}</span><div><strong>${escapeHtml(account.name)}</strong><small>Số dư ban đầu ${money(account.openingBalance)}</small></div><strong class="wallet-balance ${balance < 0 ? 'negative' : ''}">${money(balance)}</strong><button class="icon-action" data-edit-account="${escapeHtml(account.id)}" aria-label="Sửa ví ${escapeHtml(account.name)}">${iconSvg('edit')}</button>${account.id !== DEFAULT_ACCOUNT.id ? `<button class="icon-action" data-delete-account="${escapeHtml(account.id)}" aria-label="Xóa ví ${escapeHtml(account.name)}">${iconSvg('close')}</button>` : ''}</div>`;
  }).join('');
  $('#transfer-list').innerHTML = state.transfers.length ? sorted(state.transfers).map((item) => `<div class="wallet-row transfer-row"><span class="wallet-row-icon">${iconSvg('transactions')}</span><div><strong>${escapeHtml(accountById(item.fromAccountId)?.name || 'Ví đã xóa')} → ${escapeHtml(accountById(item.toAccountId)?.name || 'Ví đã xóa')}</strong><small>${dateName(item.date)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div><strong class="wallet-balance">${money(item.amount)}</strong><button class="icon-action" data-edit-transfer="${escapeHtml(item.id)}" aria-label="Sửa chuyển tiền">${iconSvg('edit')}</button><button class="icon-action" data-delete-transfer="${escapeHtml(item.id)}" aria-label="Xóa chuyển tiền">${iconSvg('close')}</button></div>`).join('') : '<div class="empty-state"><strong>Chưa chuyển tiền</strong>Chuyển giữa ví không làm thay đổi tổng thu hoặc chi.</div>';
  $('#goal-list').innerHTML = state.goals.length ? state.goals.map((goal) => {
    const percent = Math.round(goal.savedAmount / goal.targetAmount * 100);
    return `<div class="goal-row"><div class="goal-heading"><strong>${escapeHtml(goal.name)}</strong><span>${percent}%${goal.deadline ? ` · Hạn ${dateName(goal.deadline)}` : ''}</span></div><div class="goal-progress"><i style="width:${Math.min(percent, 100)}%"></i></div><div class="goal-foot"><span>Đã dành ${money(goal.savedAmount)} / ${money(goal.targetAmount)}</span><span>${goal.savedAmount >= goal.targetAmount ? 'Đã đạt mục tiêu' : `Còn ${money(goal.targetAmount - goal.savedAmount)}`}</span></div><div class="goal-actions"><button class="text-link" data-edit-goal="${escapeHtml(goal.id)}">Cập nhật</button><button class="text-link" data-delete-goal="${escapeHtml(goal.id)}">Xóa</button></div></div>`;
  }).join('') : '<div class="empty-state"><strong>Chưa có mục tiêu</strong>Đặt mục tiêu đầu tiên và cập nhật số tiền đã dành riêng.</div>';
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
  $('#transaction-account').innerHTML = state.accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
  $('#transaction-account').value = source?.accountId || DEFAULT_ACCOUNT.id;
  if (source) { $('#transaction-amount').value = formatAmountInput(source.amount); $('#transaction-date').value = source.date || todayLocal(); $('#transaction-note').value = source.note || ''; }
  $('#transaction-dialog').showModal();
  $('#transaction-amount').focus();
}

function openAccount(id = '') {
  const account = id ? accountById(id) : null;
  $('#account-form').reset();
  $('#account-id').value = account?.id || '';
  $('#account-dialog-title').textContent = account ? 'Sửa ví' : 'Thêm ví';
  $('#account-name').value = account?.name || '';
  $('#account-opening').value = account?.openingBalance ?? 0;
  $('#account-dialog').showModal();
  $('#account-name').focus();
}

function openTransfer(id = '') {
  if (state.accounts.length < 2) { toast('Cần ít nhất hai ví để chuyển tiền'); return; }
  const item = state.transfers.find((entry) => entry.id === id);
  $('#transfer-form').reset();
  $('#transfer-id').value = item?.id || '';
  $('#transfer-dialog-title').textContent = item ? 'Sửa chuyển tiền' : 'Chuyển giữa các ví';
  const options = state.accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
  $('#transfer-from').innerHTML = options;
  $('#transfer-to').innerHTML = options;
  $('#transfer-from').value = item?.fromAccountId || state.accounts[0].id;
  $('#transfer-to').value = item?.toAccountId || state.accounts[1].id;
  $('#transfer-amount').value = item ? formatAmountInput(item.amount) : '';
  $('#transfer-date').value = item?.date || todayLocal();
  $('#transfer-note').value = item?.note || '';
  $('#transfer-dialog').showModal();
  $('#transfer-amount').focus();
}

function openGoal(id = '') {
  const goal = state.goals.find((item) => item.id === id);
  $('#goal-form').reset();
  $('#goal-id').value = goal?.id || '';
  $('#goal-dialog-title').textContent = goal ? 'Cập nhật mục tiêu' : 'Thêm mục tiêu';
  $('#goal-name').value = goal?.name || '';
  $('#goal-target').value = goal?.targetAmount || '';
  $('#goal-saved').value = goal?.savedAmount ?? 0;
  $('#goal-deadline').value = goal?.deadline || '';
  $('#goal-dialog').showModal();
  $('#goal-name').focus();
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
  if (row.kind === 'budget_total') return `Ngân sách ${row.record_id.startsWith('year:') ? `năm ${row.record_id.slice(5)}` : monthName(row.record_id)}\nGiới hạn: ${money(item.amount)}`;
  if (row.kind === 'category_budget') return `Ngân sách danh mục: ${categoryById(item.categoryId)?.name || item.categoryId}\n${monthName(item.month)} · ${money(item.amount)}`;
  const lines = [item.name || (row.kind === 'transaction' ? 'Giao dịch' : row.record_id)];
  if (item.type) lines.push(({ income: 'Khoản thu', expense: 'Khoản chi', transfer: 'Chuyển tiền', account: 'Ví', goal: 'Mục tiêu' })[item.type] || item.type);
  if (Number.isSafeInteger(item.amount)) lines.push(`Số tiền: ${money(item.amount)}`);
  if (Number.isSafeInteger(item.openingBalance)) lines.push(`Số dư ban đầu: ${money(item.openingBalance)}`);
  if (Number.isSafeInteger(item.targetAmount)) lines.push(`Mục tiêu: ${money(item.targetAmount)} · Đã dành ${money(item.savedAmount)}`);
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
  const rows = [['Ngày', 'Loại', 'Danh mục', 'Số tiền (VND)', 'Ghi chú', 'Ví'], ...sorted(items).map((item) => [item.date, item.type === 'income' ? 'Thu' : 'Chi', categoryById(item.categoryId)?.name || '', item.amount, item.note || '', accountById(item.accountId)?.name || ''])];
  const csv = '\ufeff' + rows.map((row) => row.map(safeCell).join(',')).join('\r\n');
  downloadFile(csv, filename, 'text/csv;charset=utf-8');
  toast(`Đã xuất ${items.length} giao dịch`);
}

function importMapping() {
  return {
    date: $('#csv-date').value, amount: $('#csv-amount').value, expense: $('#csv-expense').value, income: $('#csv-income').value,
    type: $('#csv-type').value, category: $('#csv-category').value, note: $('#csv-note').value,
    accountId: $('#csv-account').value, defaultType: $('#csv-default-type').value,
    expenseCategoryId: $('#csv-expense-category').value, incomeCategoryId: $('#csv-income-category').value,
  };
}

function renderCsvPreview(resetSelection = false) {
  if (!csvSource) return;
  csvPreview = prepareCsvImport(csvSource.rows, importMapping(), state);
  if (resetSelection) csvSelection = new Set(csvPreview.filter((row) => row.item && !row.duplicate).map((row) => row.index));
  const errors = csvPreview.filter((row) => row.error).length, duplicates = csvPreview.filter((row) => row.duplicate).length;
  $('#csv-preview-summary').textContent = `${csvPreview.length} dòng · ${errors} lỗi · ${duplicates} trùng · ${csvSelection.size} được chọn. Dòng trùng được bỏ chọn mặc định; bạn có thể chọn lại nếu đó là giao dịch riêng.`;
  $('#csv-preview').innerHTML = csvPreview.map((row) => `<label class="csv-preview-row ${row.error ? 'invalid' : row.duplicate ? 'duplicate' : ''}"><input type="checkbox" data-csv-row="${row.index}" ${csvSelection.has(row.index) ? 'checked' : ''} ${row.error ? 'disabled' : ''}/><span>${row.item ? `${dateName(row.item.date)} · ${row.item.type === 'expense' ? 'Chi' : 'Thu'} · ${escapeHtml(categoryById(row.item.categoryId)?.name || '')}${row.item.note ? ` · ${escapeHtml(row.item.note)}` : ''}` : `Dòng ${row.index + 2}: ${escapeHtml(row.error)}`}</span><strong>${row.item ? money(row.item.amount) : ''}</strong>${row.duplicate ? '<em>Trùng</em>' : ''}</label>`).join('');
  $('#csv-confirm').disabled = !csvSelection.size;
}

function openChartTransactions({ month = '', year = '', category = '' }) {
  if (month) { selectedMonth = month; selectedYear = month.slice(0, 4); render(); }
  if (year) selectedYear = year;
  $('#search-input').value = '';
  $('#type-filter').value = category ? 'expense' : 'all';
  $('#account-filter').value = 'all';
  $('#category-filter').value = category || 'all';
  if (month) {
    $('#period-filter').value = 'month';
    $('#date-range-fields').hidden = true;
  } else {
    $('#period-filter').value = 'range';
    $('#date-range-fields').hidden = false;
    $('#date-from').value = `${year}-01-01`;
    $('#date-to').value = `${year}-12-31`;
  }
  renderTransactions(); setView('transactions');
}

function openCsvPreview(file, text) {
  csvSource = parseCsv(text);
  $('#csv-filename').textContent = `${file.name} · ${csvSource.rows.length} dòng. Chọn cột tương ứng rồi kiểm tra từng giao dịch trước khi nhập.`;
  const options = '<option value="">— Không dùng —</option>' + csvSource.headers.map((header, index) => `<option value="${index}">${escapeHtml(header || `Cột ${index + 1}`)}</option>`).join('');
  for (const id of ['date', 'amount', 'expense', 'income', 'type', 'category', 'note']) $(`#csv-${id}`).innerHTML = options;
  const guess = (...patterns) => csvSource.headers.findIndex((header) => patterns.some((pattern) => pattern.test(header.trim().toLocaleLowerCase('vi'))));
  const setGuess = (id, index) => { if (index >= 0) $(`#csv-${id}`).value = String(index); };
  setGuess('date', guess(/^ngày/, /^date/, /transaction date/));
  setGuess('expense', guess(/^(chi|debit|withdrawal|money out)/, /tiền ra/));
  setGuess('income', guess(/^(thu|credit|deposit|money in)/, /tiền vào/));
  if ($('#csv-expense').value === '' && $('#csv-income').value === '') setGuess('amount', guess(/số tiền/, /amount/, /giá trị/));
  setGuess('type', guess(/^loại/, /^type/, /direction/));
  setGuess('category', guess(/danh mục/, /category/));
  setGuess('note', guess(/ghi chú/, /nội dung/, /mô tả/, /description/, /note/, /memo/));
  $('#csv-account').innerHTML = state.accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
  for (const type of ['expense', 'income']) $(`#csv-${type}-category`).innerHTML = state.categories.filter((item) => item.type === type).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  $('#csv-default-type').value = 'expense';
  renderCsvPreview(true);
  $('#import-csv-dialog').showModal();
}

document.addEventListener('click', (event) => {
  const drill = event.target.closest('[data-drill-month],[data-drill-year]');
  if (drill) { openChartTransactions({ month: drill.dataset.drillMonth, year: drill.dataset.drillYear, category: drill.dataset.drillCategory }); return; }
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.view) setView(target.dataset.view);
  if (target.dataset.heatDate) {
    $('#search-input').value = '';
    $('#type-filter').value = 'all';
    $('#category-filter').value = 'all';
    $('#account-filter').value = 'all';
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
    if (item && confirm(`Xóa mẫu "${item.name}"?`)) { const deleted = structuredClone(item); state.templates = state.templates.filter((entry) => entry.id !== item.id); deletedWithUndo('Đã xóa mẫu', () => { if (!state.templates.some((entry) => entry.id === deleted.id)) state.templates.push(deleted); }); }
  }
  if (target.id === 'add-recurring') openRecurring();
  if (target.dataset.editRecurring) openRecurring(target.dataset.editRecurring);
  if (target.dataset.deleteRecurring) {
    const rule = state.recurring.find((entry) => entry.id === target.dataset.deleteRecurring);
    if (rule && confirm(`Xóa khoản định kỳ "${rule.name}"? Các giao dịch đã xác nhận vẫn được giữ.`)) { const deleted = structuredClone(rule); state.recurring = state.recurring.filter((entry) => entry.id !== rule.id); deletedWithUndo('Đã xóa khoản định kỳ', () => { if (!state.recurring.some((entry) => entry.id === deleted.id)) state.recurring.push(deleted); }); }
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
    if (item && confirm(`Xóa giao dịch ${money(item.amount)}?`)) {
      const deleted = structuredClone(item);
      state.transactions = state.transactions.filter((entry) => entry.id !== item.id);
      deletedWithUndo('Đã xóa giao dịch', () => { if (!state.transactions.some((entry) => entry.id === deleted.id)) state.transactions.push(deleted); });
    }
  }
  if (target.id === 'add-account') openAccount();
  if (target.dataset.editAccount) openAccount(target.dataset.editAccount);
  if (target.dataset.deleteAccount) {
    const id = target.dataset.deleteAccount, account = accountById(id);
    if (state.transactions.some((item) => (item.accountId || DEFAULT_ACCOUNT.id) === id) || state.transfers.some((item) => item.fromAccountId === id || item.toAccountId === id)) { toast('Ví đang có giao dịch hoặc chuyển tiền, không thể xóa'); return; }
    if (account && id !== DEFAULT_ACCOUNT.id && confirm(`Xóa ví "${account.name}"?`)) { const deleted = structuredClone(account); state.accounts = state.accounts.filter((item) => item.id !== id); deletedWithUndo('Đã xóa ví', () => { if (!state.accounts.some((item) => item.id === deleted.id)) state.accounts.push(deleted); }); }
  }
  if (target.id === 'add-transfer') openTransfer();
  if (target.dataset.editTransfer) openTransfer(target.dataset.editTransfer);
  if (target.dataset.deleteTransfer) {
    const item = state.transfers.find((entry) => entry.id === target.dataset.deleteTransfer);
    if (item && confirm(`Xóa chuyển tiền ${money(item.amount)}?`)) { const deleted = structuredClone(item); state.transfers = state.transfers.filter((entry) => entry.id !== item.id); deletedWithUndo('Đã xóa chuyển tiền', () => { if (!state.transfers.some((entry) => entry.id === deleted.id)) state.transfers.push(deleted); }); }
  }
  if (target.id === 'add-goal') openGoal();
  if (target.dataset.editGoal) openGoal(target.dataset.editGoal);
  if (target.dataset.deleteGoal) {
    const goal = state.goals.find((item) => item.id === target.dataset.deleteGoal);
    if (goal && confirm(`Xóa mục tiêu "${goal.name}"?`)) { const deleted = structuredClone(goal); state.goals = state.goals.filter((item) => item.id !== goal.id); deletedWithUndo('Đã xóa mục tiêu', () => { if (!state.goals.some((item) => item.id === deleted.id)) state.goals.push(deleted); }); }
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
      const deleted = structuredClone(category);
      const limits = Object.fromEntries(Object.entries(state.budgets).filter(([, budget]) => budget.categories && Object.hasOwn(budget.categories, id)).map(([month, budget]) => [month, budget.categories[id]]));
      state.categories = state.categories.filter((item) => item.id !== id);
      Object.values(state.budgets).forEach((budget) => { if (budget.categories) delete budget.categories[id]; });
      deletedWithUndo('Đã xóa danh mục', () => {
        if (!state.categories.some((item) => item.id === id)) state.categories.push(deleted);
        for (const [month, limit] of Object.entries(limits)) if (state.budgets[month]?.categories) state.budgets[month].categories[id] = limit;
      });
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

$('#undo-delete').addEventListener('click', () => {
  if (!undoDeleteAction) return;
  const restore = undoDeleteAction;
  undoDeleteAction = undefined; clearTimeout(undoTimer); $('#undo-delete').hidden = true;
  restore(); saveState(); render(); toast('Đã khôi phục mục vừa xóa');
});

$('#backup-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Tệp sao lưu quá lớn (tối đa 10 MB)'); return; }
  try {
    pendingRestore = parseBackup(await file.text());
    const { transactions, categories, budgets, templates, recurring, accounts, transfers, goals } = pendingRestore.data;
    const exportedAt = new Date(pendingRestore.exportedAt).toLocaleString('vi-VN');
    $('#restore-summary').textContent = `Bản sao lưu ngày ${exportedAt}: ${transactions.length} giao dịch, ${categories.length} danh mục, ${Object.keys(budgets).length} tháng ngân sách, ${templates.length} mẫu nhanh, ${recurring.length} khoản định kỳ, ${accounts.length} ví, ${transfers.length} chuyển tiền và ${goals.length} mục tiêu.`;
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
  $('#account-filter').value = 'all';
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
  const type = $('#transaction-type').value, categoryId = $('#transaction-category').value, date = $('#transaction-date').value, accountId = $('#transaction-account').value;
  if (amount === null || !validDate(date) || categoryById(categoryId)?.type !== type || !accountById(accountId)) { toast('Kiểm tra lại số tiền, ngày, danh mục và ví'); return; }
  const id = $('#transaction-id').value;
  const existing = state.transactions.find((item) => item.id === id);
  const next = { id: existing?.id || id || uid(), type, amount, categoryId, accountId, date, note: $('#transaction-note').value.trim(), createdAt: existing?.createdAt || new Date().toISOString() };
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
for (const selector of ['#transaction-amount', '#recurring-amount', '#transfer-amount']) $(selector).addEventListener('input', onAmountInput);

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
  const budget = ensureBudget(); budget.total = amount; budget.rollover = $('#budget-rollover').checked; saveState(); render(); toast('Đã lưu ngân sách tháng');
});

$('#annual-budget-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const amount = amountInput($('#annual-budget-input').value || '0', true);
  if (amount === null) { toast('Giới hạn năm phải là số nguyên không âm'); return; }
  state.annualBudgets[selectedYear] = amount;
  saveState(); render(); toast('Đã lưu ngân sách năm');
});

$('#account-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#account-name').value.trim(), openingBalance = Number($('#account-opening').value);
  if (!name || !Number.isSafeInteger(openingBalance) || Math.abs(openingBalance) > 999999999999) { toast('Kiểm tra tên và số dư ban đầu'); return; }
  const existing = state.accounts.find((item) => item.id === $('#account-id').value);
  if (state.accounts.some((item) => item.id !== existing?.id && item.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) { toast('Tên ví đã tồn tại'); return; }
  if (existing) Object.assign(existing, { name, openingBalance }); else state.accounts.push({ id: uid(), name, openingBalance });
  $('#account-dialog').close(); saveState(); render(); toast(existing ? 'Đã cập nhật ví' : 'Đã thêm ví');
});

$('#transfer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const fromAccountId = $('#transfer-from').value, toAccountId = $('#transfer-to').value;
  const amount = amountInput(amountDigits($('#transfer-amount').value)), date = $('#transfer-date').value;
  if (amount === null || !validDate(date) || fromAccountId === toAccountId || !accountById(fromAccountId) || !accountById(toAccountId)) { toast('Kiểm tra hai ví, ngày và số tiền'); return; }
  const existing = state.transfers.find((item) => item.id === $('#transfer-id').value);
  const next = { id: existing?.id || uid(), fromAccountId, toAccountId, amount, date, note: $('#transfer-note').value.trim() };
  if (existing) Object.assign(existing, next); else state.transfers.push(next);
  $('#transfer-dialog').close(); saveState(); render(); toast(existing ? 'Đã sửa chuyển tiền' : 'Đã chuyển tiền giữa ví');
});

$('#goal-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#goal-name').value.trim(), targetAmount = amountInput($('#goal-target').value), savedAmount = amountInput($('#goal-saved').value || '0', true), deadline = $('#goal-deadline').value;
  if (!name || targetAmount === null || savedAmount === null || (deadline && !validDate(deadline))) { toast('Kiểm tra mục tiêu và số tiền'); return; }
  const existing = state.goals.find((item) => item.id === $('#goal-id').value);
  const next = { id: existing?.id || uid(), name, targetAmount, savedAmount, deadline };
  if (existing) Object.assign(existing, next); else state.goals.push(next);
  $('#goal-dialog').close(); saveState(); render(); toast(existing ? 'Đã cập nhật mục tiêu' : 'Đã thêm mục tiêu');
});

$('#month-input').addEventListener('change', (event) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) return;
  selectedMonth = event.target.value; selectedYear = selectedMonth.slice(0, 4); render();
});
$('#year-input').addEventListener('change', (event) => { selectedYear = event.target.value; renderYearly(); });
$('#trend-category').addEventListener('change', (event) => { selectedTrendCategory = event.target.value; renderCategoryTrend(annualReport(state, selectedYear)); });
for (const selector of ['#search-input', '#type-filter', '#category-filter', '#account-filter']) $(selector).addEventListener(selector === '#search-input' ? 'input' : 'change', renderTransactions);
$('#period-filter').addEventListener('change', (event) => { $('#date-range-fields').hidden = event.target.value !== 'range'; renderTransactions(); });
for (const selector of ['#date-from', '#date-to']) $(selector).addEventListener('change', renderTransactions);
$('#sidebar-export').addEventListener('click', () => exportCsv(state.transactions, `moneynote-tat-ca-${todayLocal()}.csv`));
$('#export-all').addEventListener('click', () => exportCsv(state.transactions, `moneynote-tat-ca-${todayLocal()}.csv`));
$('#export-filtered').addEventListener('click', () => exportCsv(filteredTransactions(), `moneynote-${selectedMonth}.csv`));
$('#import-csv-open').addEventListener('click', () => $('#import-csv-file').click());
$('#import-csv-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('CSV tối đa 5 MB mỗi lần'); return; }
  try { openCsvPreview(file, await file.text()); }
  catch (error) { csvSource = undefined; toast(error.message || 'Không thể đọc CSV'); }
});
for (const id of ['date', 'amount', 'expense', 'income', 'type', 'category', 'note', 'account', 'default-type', 'expense-category', 'income-category']) $(`#csv-${id}`).addEventListener('change', () => renderCsvPreview(true));
$('#csv-preview').addEventListener('change', (event) => {
  const index = Number(event.target.dataset.csvRow);
  if (!Number.isInteger(index)) return;
  if (event.target.checked) csvSelection.add(index); else csvSelection.delete(index);
  $('#csv-confirm').disabled = !csvSelection.size;
  $('#csv-preview-summary').textContent = $('#csv-preview-summary').textContent.replace(/\d+ được chọn/, `${csvSelection.size} được chọn`);
});
$('#csv-confirm').addEventListener('click', () => {
  const selected = csvPreview.filter((row) => row.item && csvSelection.has(row.index));
  if (!selected.length) { toast('Chưa chọn giao dịch hợp lệ'); return; }
  const previous = structuredClone(state);
  const createdAt = new Date().toISOString();
  state.transactions.push(...selected.map(({ item }) => ({ id: uid(), ...item, createdAt })));
  if (!saveState()) { state = previous; return; }
  const latest = selected.reduce((date, row) => row.item.date > date ? row.item.date : date, '');
  selectedMonth = latest.slice(0, 7); selectedYear = latest.slice(0, 4);
  $('#import-csv-dialog').close(); csvSource = undefined; csvPreview = []; csvSelection.clear();
  render(); setView('transactions'); toast(`Đã nhập ${selected.length} giao dịch`);
});
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
