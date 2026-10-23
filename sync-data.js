export const recordKey = (kind, id) => JSON.stringify([kind, id]);

export function recordsOf(state) {
  const records = new Map();
  const add = (kind, id, payload) => records.set(recordKey(kind, id), { kind, record_id: id, payload });
  for (const item of state.transactions) add('transaction', item.id, item);
  for (const item of state.categories) add('category', item.id, item);
  for (const item of state.templates || []) add('template', item.id, item);
  for (const item of state.recurring || []) add('recurring', item.id, item);
  for (const [month, budget] of Object.entries(state.budgets)) {
    if (!budget || typeof budget !== 'object') continue;
    add('budget_total', month, { amount: Number(budget.total) || 0 });
    for (const [categoryId, amount] of Object.entries(budget.categories || {})) {
      add('category_budget', JSON.stringify([month, categoryId]), { month, categoryId, amount: Number(amount) || 0 });
    }
  }
  return records;
}

export function diffRecords(previous, next) {
  const before = recordsOf(previous), after = recordsOf(next), changes = [];
  for (const [key, record] of after) {
    if (JSON.stringify(before.get(key)?.payload) !== JSON.stringify(record.payload)) changes.push({ ...record, deleted: false });
  }
  for (const [key, record] of before) {
    if (!after.has(key)) changes.push({ ...record, payload: {}, deleted: true });
  }
  return changes;
}

export function stateFromRecords(rows, pending = [], fallbackCategories = []) {
  const records = new Map(rows.map((row) => [recordKey(row.kind, row.record_id), row]));
  for (const row of pending) records.set(recordKey(row.kind, row.record_id), row);
  const result = { transactions: [], categories: [], budgets: {}, templates: [], recurring: [] };
  for (const row of records.values()) {
    if (row.deleted) continue;
    const item = row.payload && typeof row.payload === 'object' ? structuredClone(row.payload) : row.payload;
    if (row.kind === 'transaction' && item && item.id === row.record_id && ['income', 'expense'].includes(item.type) && Number.isSafeInteger(item.amount) && item.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) result.transactions.push(item);
    if (row.kind === 'category' && item && item.id === row.record_id && ['income', 'expense'].includes(item.type) && typeof item.name === 'string') result.categories.push(item);
    if (row.kind === 'template' && item && item.id === row.record_id && ['income', 'expense'].includes(item.type) && Number.isSafeInteger(item.amount) && item.amount > 0 && typeof item.name === 'string') result.templates.push(item);
    if (row.kind === 'recurring' && item && item.id === row.record_id && ['income', 'expense'].includes(item.type) && Number.isSafeInteger(item.amount) && item.amount > 0 && Number.isInteger(item.day) && item.day >= 1 && item.day <= 31 && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.startMonth)) result.recurring.push(item);
    if (row.kind === 'budget_total' && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.record_id) && Number.isSafeInteger(item?.amount) && item.amount >= 0) {
      result.budgets[row.record_id] ||= { total: 0, categories: {} };
      result.budgets[row.record_id].total = item.amount;
    }
    if (row.kind === 'category_budget' && /^\d{4}-(0[1-9]|1[0-2])$/.test(item?.month) && typeof item.categoryId === 'string' && Number.isSafeInteger(item.amount) && item.amount >= 0) {
      result.budgets[item.month] ||= { total: 0, categories: {} };
      result.budgets[item.month].categories[item.categoryId] = item.amount;
    }
  }
  if (!rows.length && !pending.length) result.categories = structuredClone(fallbackCategories);
  return result;
}

export function hasPersonalData(state, defaults) {
  if (state.transactions.length || state.templates?.length || state.recurring?.length || Object.values(state.budgets).some((budget) => budget && (budget.total || Object.values(budget.categories || {}).some(Boolean)))) return true;
  return JSON.stringify(state.categories) !== JSON.stringify(defaults);
}

export function mergeUniqueRecords(remoteRows, localState) {
  const remote = new Map(remoteRows.map((row) => [recordKey(row.kind, row.record_id), row]));
  return [...recordsOf(localState)].filter(([key]) => !remote.has(key)).map(([, row]) => ({ ...row, deleted: false }));
}
