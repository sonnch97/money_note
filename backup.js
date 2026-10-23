const FORMAT = 'moneynote-backup';
const VERSION = 2;
const MAX_AMOUNT = 999999999999;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validAmount = (value, allowZero = false) => Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= MAX_AMOUNT;
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const validMonth = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !['__proto__', 'constructor', 'prototype'].includes(value);

function invalid(detail) { throw new Error(`Bản sao lưu không hợp lệ: ${detail}.`); }

export function createBackup(state) {
  const data = { transactions: state.transactions, categories: state.categories, budgets: state.budgets, templates: state.templates || [], recurring: state.recurring || [] };
  return JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), data }, null, 2);
}

export function parseBackup(text) {
  let backup;
  try { backup = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { invalid('tệp không phải JSON'); }
  if (!isRecord(backup) || backup.format !== FORMAT || ![1, VERSION].includes(backup.version) || !isRecord(backup.data)) invalid('sai định dạng hoặc phiên bản');
  if (typeof backup.exportedAt !== 'string' || Number.isNaN(Date.parse(backup.exportedAt))) invalid('thiếu ngày sao lưu');

  const { transactions, categories, budgets } = backup.data;
  if (!Array.isArray(transactions) || !Array.isArray(categories) || !isRecord(budgets)) invalid('thiếu giao dịch, danh mục hoặc ngân sách');
  if (backup.version === VERSION && (!Array.isArray(backup.data.templates) || !Array.isArray(backup.data.recurring))) invalid('thiếu mẫu nhanh hoặc khoản định kỳ');

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

  const safeItems = (items, recurring) => {
    const ids = new Set();
    return (items || []).map((item) => {
      if (!isRecord(item) || !validId(item.id) || (recurring && item.id.length > 480) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 || !['income', 'expense'].includes(item.type) || !validAmount(item.amount) || !validId(item.categoryId) || typeof item.note !== 'string' || item.note.length > 120) invalid(recurring ? 'khoản định kỳ bị lỗi' : 'mẫu nhanh bị lỗi');
      if (ids.has(item.id)) invalid(recurring ? 'mã khoản định kỳ bị trùng' : 'mã mẫu nhanh bị trùng');
      ids.add(item.id);
      const base = { id: item.id, name: item.name, type: item.type, amount: item.amount, categoryId: item.categoryId, note: item.note };
      if (!recurring) return base;
      if (!Number.isInteger(item.day) || item.day < 1 || item.day > 31 || !validMonth(item.startMonth) || !Array.isArray(item.skippedMonths) || item.skippedMonths.some((month) => !validMonth(month))) invalid('lịch khoản định kỳ bị lỗi');
      return { ...base, day: item.day, startMonth: item.startMonth, skippedMonths: [...new Set(item.skippedMonths)] };
    });
  };
  return { exportedAt: backup.exportedAt, data: { transactions: safeTransactions, categories: safeCategories, budgets: safeBudgets, templates: safeItems(backup.version === 1 ? [] : backup.data.templates, false), recurring: safeItems(backup.version === 1 ? [] : backup.data.recurring, true) } };
}
