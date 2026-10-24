export function filterTransactions(state, { query = '', type = 'all', category = 'all', period = 'all', month = '', from = '', to = '' }) {
  const text = query.trim().toLocaleLowerCase('vi');
  const names = new Map(state.categories.map((item) => [item.id, item.name]));
  return state.transactions.filter((item) => {
    if (type !== 'all' && item.type !== type) return false;
    if (category !== 'all' && item.categoryId !== category) return false;
    if (period === 'month' && item.date.slice(0, 7) !== month) return false;
    if (period === 'range' && ((from && item.date < from) || (to && item.date > to))) return false;
    return !text || `${item.note || ''} ${names.get(item.categoryId) || ''}`.toLocaleLowerCase('vi').includes(text);
  });
}

export function annualReport(state, year) {
  const transactions = state.transactions.filter((item) => item.date.slice(0, 4) === String(year));
  const months = Array.from({ length: 12 }, (_, index) => ({
    number: index + 1,
    income: 0,
    expense: 0,
  }));
  const categoryAmounts = new Map();
  let incomeTotal = 0;
  let expenseTotal = 0;
  for (const item of transactions) {
    const month = months[Number(item.date.slice(5, 7)) - 1];
    if (!month) continue;
    if (item.type === 'income') {
      month.income += item.amount;
      incomeTotal += item.amount;
    } else if (item.type === 'expense') {
      month.expense += item.amount;
      expenseTotal += item.amount;
      categoryAmounts.set(item.categoryId, (categoryAmounts.get(item.categoryId) || 0) + item.amount);
    }
  }
  const categories = [...categoryAmounts].map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  return { transactions, months, incomeTotal, expenseTotal, categories };
}

export function budgetAlerts(state, month) {
  const budget = state.budgets[month];
  if (!budget) return [];
  const expenses = state.transactions.filter((item) => item.type === 'expense' && item.date.slice(0, 7) === month);
  const alerts = [];
  const check = (scope, categoryId, limit, spent) => {
    if (!Number.isSafeInteger(limit) || limit <= 0 || spent < limit * 0.8) return;
    alerts.push({ scope, categoryId, limit, spent, percent: Math.round(spent / limit * 100), level: spent >= limit ? 'danger' : 'warning' });
  };
  check('total', '', Number(budget.total), expenses.reduce((total, item) => total + item.amount, 0));
  for (const [categoryId, limit] of Object.entries(budget.categories || {})) {
    check('category', categoryId, Number(limit), expenses.filter((item) => item.categoryId === categoryId).reduce((total, item) => total + item.amount, 0));
  }
  return alerts.sort((a, b) => (a.level === 'danger' ? 0 : 1) - (b.level === 'danger' ? 0 : 1) || b.percent - a.percent);
}

export function recurringOccurrence(rule, month) {
  if (month < rule.startMonth) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const day = Math.min(rule.day, lastDay);
  return {
    id: `recurring:${rule.id}:${month}`,
    type: rule.type,
    amount: rule.amount,
    categoryId: rule.categoryId,
    date: `${month}-${String(day).padStart(2, '0')}`,
    note: rule.note || rule.name,
  };
}

export function dueRecurring(state, month, today) {
  const existing = new Set(state.transactions.map((item) => item.id));
  return state.recurring.flatMap((rule) => {
    const occurrence = recurringOccurrence(rule, month);
    return occurrence && occurrence.date <= today && !existing.has(occurrence.id) && !(rule.skippedMonths || []).includes(month)
      ? [{ rule, occurrence }] : [];
  });
}
