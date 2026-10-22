import { createBackup, parseBackup } from './backup.js';

const STORAGE_KEY = 'moneynote.v1';
const palette = ['#c95772', '#e58fa2', '#f4b2bd', '#eeaa8c', '#b5a0ce', '#dfc27c', '#9db9ad', '#c3cfaa'];
const defaultCategories = [
  { id: 'food', name: 'Ăn uống', type: 'expense', icon: '◕' },
  { id: 'shopping', name: 'Mua sắm', type: 'expense', icon: '▣' },
  { id: 'home', name: 'Nhà cửa', type: 'expense', icon: '⌂' },
  { id: 'transport', name: 'Di chuyển', type: 'expense', icon: '◎' },
  { id: 'health', name: 'Sức khỏe', type: 'expense', icon: '✚' },
  { id: 'learning', name: 'Học tập', type: 'expense', icon: '♧' },
  { id: 'fun', name: 'Giải trí', type: 'expense', icon: '✦' },
  { id: 'other-expense', name: 'Khác', type: 'expense', icon: '◈' },
  { id: 'salary', name: 'Lương', type: 'income', icon: '↗' },
  { id: 'bonus', name: 'Thưởng', type: 'income', icon: '✦' },
  { id: 'other-income', name: 'Thu nhập khác', type: 'income', icon: '◈' },
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value || 0)} ₫`;
const compactMoney = (value) => value >= 1000000 ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value / 1000000)}tr` : value >= 1000 ? `${Math.round(value / 1000)}k` : `${value || 0}₫`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
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
    };
  } catch {
    return { transactions: [], categories: structuredClone(defaultCategories), budgets: {} };
  }
}

let state = loadState();
let selectedMonth = currentMonth();
let activeView = 'overview';
let toastTimer;
let pendingRestore;

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { toast('Không thể lưu trên thiết bị. Hãy xuất CSV để giữ dữ liệu.'); }
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
  if (!['overview', 'transactions', 'budgets', 'categories'].includes(view)) return;
  activeView = view;
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === view));
  $$('[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $('#breadcrumb-current').textContent = { overview: 'Tổng quan', transactions: 'Giao dịch', budgets: 'Ngân sách', categories: 'Danh mục' }[view];
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
  renderCategoryChart(expenseItems);
  renderOverviewBudget(expense);
  renderRecent(items);
  renderTransactionFilters();
  renderTransactions();
  renderBudgets(expense);
  renderCategories();
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
  return `<div class="${actions ? 'transaction-item' : 'recent-item'}"><span class="category-badge ${item.type === 'income' ? 'income' : ''}" aria-hidden="true">${escapeHtml(category?.icon || '◈')}</span><div class="transaction-info"><strong>${escapeHtml(item.note || category?.name || 'Giao dịch')}</strong><span>${escapeHtml(detail)}</span></div><strong class="transaction-amount ${item.type}">${item.type === 'income' ? '+' : '−'}${money(item.amount)}</strong>${actions ? `<div class="transaction-actions"><button class="icon-action" data-edit-transaction="${escapeHtml(item.id)}" aria-label="Sửa giao dịch">✎</button><button class="icon-action" data-delete-transaction="${escapeHtml(item.id)}" aria-label="Xóa giao dịch">×</button></div>` : ''}</div>`;
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
  const query = $('#search-input').value.trim().toLocaleLowerCase('vi');
  const type = $('#type-filter').value, category = $('#category-filter').value;
  return sorted(monthlyTransactions().filter((item) => {
    const categoryName = categoryById(item.categoryId)?.name || '';
    return (type === 'all' || item.type === type) && (category === 'all' || item.categoryId === category) && (!query || `${item.note || ''} ${categoryName}`.toLocaleLowerCase('vi').includes(query));
  }));
}

function renderTransactions() {
  const items = filteredTransactions();
  $('#transaction-count').textContent = `${items.length} giao dịch`;
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
    return `<div class="category-budget-row"><div class="budget-row-name"><span class="category-badge">${escapeHtml(category.icon)}</span><strong>${escapeHtml(category.name)}</strong></div><div class="budget-mini"><span>${money(spent)}${limit ? ` / ${money(limit)} · ${percentage}%` : ' đã chi'}</span><div class="progress-track"><div class="progress-fill ${percentage >= 100 ? 'danger' : percentage >= 80 ? 'warning' : ''}" style="width:${Math.min(percentage, 100)}%"></div></div></div><div class="budget-input-wrap"><input type="number" min="0" step="1000" inputmode="numeric" value="${limit || ''}" data-budget-input="${escapeHtml(category.id)}" aria-label="Ngân sách ${escapeHtml(category.name)}" placeholder="Chưa đặt" /><button data-save-budget="${escapeHtml(category.id)}" aria-label="Lưu ngân sách ${escapeHtml(category.name)}">✓</button></div></div>`;
  }).join('');
}

function renderCategories() {
  for (const type of ['expense', 'income']) {
    const categories = state.categories.filter((item) => item.type === type);
    $(`#${type}-categories`).innerHTML = categories.length ? categories.map((item) => {
      const count = state.transactions.filter((transaction) => transaction.categoryId === item.id).length;
      return `<div class="category-row"><span class="category-badge ${type === 'income' ? 'income' : ''}">${escapeHtml(item.icon)}</span><strong>${escapeHtml(item.name)}</strong><small>${count} giao dịch</small><button class="icon-action" data-edit-category="${escapeHtml(item.id)}" aria-label="Sửa ${escapeHtml(item.name)}">✎</button><button class="icon-action" data-delete-category="${escapeHtml(item.id)}" aria-label="Xóa ${escapeHtml(item.name)}">×</button></div>`;
    }).join('') : '<div class="empty-state">Chưa có danh mục.</div>';
  }
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

function openTransaction(id = '') {
  $('#transaction-form').reset();
  $('#transaction-id').value = id;
  $('#transaction-date').value = selectedMonth === currentMonth() ? todayLocal() : `${selectedMonth}-01`;
  const item = state.transactions.find((transaction) => transaction.id === id);
  $('#transaction-dialog-title').textContent = item ? 'Sửa giao dịch' : 'Thêm giao dịch';
  setTransactionType(item?.type || 'expense', item?.categoryId);
  if (item) { $('#transaction-amount').value = formatAmountInput(item.amount); $('#transaction-date').value = item.date; $('#transaction-note').value = item.note || ''; }
  $('#transaction-dialog').showModal();
  $('#transaction-amount').focus();
}

function openCategory(id = '') {
  $('#category-form').reset();
  $('#category-id').value = id;
  const category = categoryById(id);
  $('#category-dialog-title').textContent = category ? 'Sửa danh mục' : 'Thêm danh mục';
  $('#category-name').value = category?.name || '';
  $('#category-type').value = category?.type || 'expense';
  $('#category-icon').value = category?.icon || '◈';
  $('#category-type').disabled = !!category && state.transactions.some((item) => item.categoryId === id);
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
  toast('Đã sao lưu giao dịch, danh mục và ngân sách');
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
  if (target.hasAttribute('data-add')) openTransaction();
  if (target.hasAttribute('data-close')) target.closest('dialog').close();
  if (target.dataset.transactionType) setTransactionType(target.dataset.transactionType);
  if (target.dataset.editTransaction) openTransaction(target.dataset.editTransaction);
  if (target.dataset.deleteTransaction) {
    const item = state.transactions.find((entry) => entry.id === target.dataset.deleteTransaction);
    if (item && confirm(`Xóa giao dịch ${money(item.amount)}?`)) { state.transactions = state.transactions.filter((entry) => entry.id !== item.id); saveState(); render(); toast('Đã xóa giao dịch'); }
  }
  if (target.id === 'add-category') openCategory();
  if (target.dataset.editCategory) openCategory(target.dataset.editCategory);
  if (target.dataset.deleteCategory) {
    const id = target.dataset.deleteCategory, category = categoryById(id);
    if (state.transactions.some((item) => item.categoryId === id)) { toast('Danh mục đã có giao dịch, không thể xóa'); return; }
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
});

$('#backup-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Tệp sao lưu quá lớn (tối đa 10 MB)'); return; }
  try {
    pendingRestore = parseBackup(await file.text());
    const { transactions, categories, budgets } = pendingRestore.data;
    const exportedAt = new Date(pendingRestore.exportedAt).toLocaleString('vi-VN');
    $('#restore-summary').textContent = `Bản sao lưu ngày ${exportedAt}: ${transactions.length} giao dịch, ${categories.length} danh mục và ${Object.keys(budgets).length} tháng ngân sách.`;
    $('#restore-dialog').showModal();
  } catch (error) {
    pendingRestore = undefined;
    toast(error.message || 'Không thể đọc tệp sao lưu');
  }
});

$('#confirm-restore').addEventListener('click', () => {
  if (!pendingRestore) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingRestore.data)); }
  catch { toast('Không thể lưu bản khôi phục trên thiết bị này'); return; }
  state = pendingRestore.data;
  pendingRestore = undefined;
  $('#restore-dialog').close();
  selectedMonth = state.transactions.length ? state.transactions.reduce((latest, item) => item.date > latest ? item.date : latest, '').slice(0, 7) : currentMonth();
  $('#search-input').value = '';
  $('#type-filter').value = 'all';
  $('#category-filter').value = 'all';
  setView('overview');
  render();
  toast('Đã khôi phục toàn bộ dữ liệu');
});

$('#restore-dialog').addEventListener('close', () => { pendingRestore = undefined; });

$('#transaction-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const amount = amountInput(amountDigits($('#transaction-amount').value));
  const type = $('#transaction-type').value, categoryId = $('#transaction-category').value, date = $('#transaction-date').value;
  if (amount === null || !validDate(date) || categoryById(categoryId)?.type !== type) { toast('Kiểm tra lại số tiền, ngày và danh mục'); return; }
  const id = $('#transaction-id').value;
  const existing = state.transactions.find((item) => item.id === id);
  const next = { id: existing?.id || uid(), type, amount, categoryId, date, note: $('#transaction-note').value.trim(), createdAt: existing?.createdAt || new Date().toISOString() };
  if (existing) Object.assign(existing, next); else state.transactions.push(next);
  $('#transaction-dialog').close(); selectedMonth = date.slice(0, 7); saveState(); render(); toast(existing ? 'Đã cập nhật giao dịch' : 'Đã thêm giao dịch');
});

$('#transaction-amount').addEventListener('input', (event) => {
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
});

$('#category-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#category-name').value.trim(), type = $('#category-type').value, icon = $('#category-icon').value;
  const id = $('#category-id').value, existing = categoryById(id);
  if (!name || !['income', 'expense'].includes(type)) return;
  if (state.categories.some((item) => item.id !== id && item.type === type && item.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) { toast('Danh mục này đã tồn tại'); return; }
  if (existing) Object.assign(existing, { name, type, icon }); else state.categories.push({ id: uid(), name, type, icon });
  $('#category-dialog').close(); saveState(); render(); toast(existing ? 'Đã sửa danh mục' : 'Đã thêm danh mục');
});

$('#total-budget-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const amount = amountInput($('#total-budget-input').value || '0', true);
  if (amount === null) { toast('Ngân sách phải là số nguyên không âm'); return; }
  ensureBudget().total = amount; saveState(); render(); toast('Đã lưu ngân sách tháng');
});

$('#month-input').addEventListener('change', (event) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) return;
  selectedMonth = event.target.value; render();
});
for (const selector of ['#search-input', '#type-filter', '#category-filter']) $(selector).addEventListener(selector === '#search-input' ? 'input' : 'change', renderTransactions);
$('#sidebar-export').addEventListener('click', () => exportCsv(state.transactions, `moneynote-tat-ca-${todayLocal()}.csv`));
$('#export-all').addEventListener('click', () => exportCsv(state.transactions, `moneynote-tat-ca-${todayLocal()}.csv`));
$('#export-filtered').addEventListener('click', () => exportCsv(filteredTransactions(), `moneynote-${selectedMonth}.csv`));
for (const dialog of $$('dialog')) dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
window.addEventListener('hashchange', () => setView(location.hash.slice(1)));

setView(location.hash.slice(1) || 'overview');
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
