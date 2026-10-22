const FORMAT = 'moneynote-backup';
const VERSION = 1;
const MAX_AMOUNT = 999999999999;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validAmount = (value, allowZero = false) => Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= MAX_AMOUNT;
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const validMonth = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(value);

function invalid(detail) { throw new Error(`Bản sao lưu không hợp lệ: ${detail}.`); }

export function createBackup(state) {
  return JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), data: state }, null, 2);
}

export function parseBackup(text) {
  let backup;
  try { backup = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { invalid('tệp không phải JSON'); }
  if (!isRecord(backup) || backup.format !== FORMAT || backup.version !== VERSION || !isRecord(backup.data)) invalid('sai định dạng hoặc phiên bản');
  if (typeof backup.exportedAt !== 'string' || Number.isNaN(Date.parse(backup.exportedAt))) invalid('thiếu ngày sao lưu');

  const { transactions, categories, budgets } = backup.data;
  if (!Array.isArray(transactions) || !Array.isArray(categories) || !isRecord(budgets)) invalid('thiếu giao dịch, danh mục hoặc ngân sách');

  const categoryIds = new Set();
  const safeCategories = categories.map((item) => {
    if (!isRecord(item) || !validId(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || !['income', 'expense'].includes(item.type) || typeof item.icon !== 'string' || item.icon.length > 16) invalid('danh mục bị lỗi');
    if (categoryIds.has(item.id)) invalid('mã danh mục bị trùng');
    categoryIds.add(item.id);
    return { id: item.id, name: item.name, type: item.type, icon: item.icon };
  });

  const transactionIds = new Set();
  const safeTransactions = transactions.map((item) => {
    if (!isRecord(item) || !validId(item.id) || !['income', 'expense'].includes(item.type) || !validAmount(item.amount) || !validDate(item.date) || !validId(item.categoryId) || typeof item.note !== 'string' || item.note.length > 5000 || (item.createdAt !== undefined && typeof item.createdAt !== 'string')) invalid('giao dịch bị lỗi');
    if (transactionIds.has(item.id)) invalid('mã giao dịch bị trùng');
    transactionIds.add(item.id);
    return { id: item.id, type: item.type, amount: item.amount, categoryId: item.categoryId, date: item.date, note: item.note, ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }) };
  });

  const safeBudgets = Object.fromEntries(Object.entries(budgets).map(([month, budget]) => {
    if (!validMonth(month) || !isRecord(budget) || !validAmount(budget.total, true) || !isRecord(budget.categories)) invalid('ngân sách bị lỗi');
    const limits = Object.fromEntries(Object.entries(budget.categories).map(([id, amount]) => {
      if (!validId(id) || !validAmount(amount, true)) invalid('ngân sách danh mục bị lỗi');
      return [id, amount];
    }));
    return [month, { total: budget.total, categories: limits }];
  }));

  return { exportedAt: backup.exportedAt, data: { transactions: safeTransactions, categories: safeCategories, budgets: safeBudgets } };
}
