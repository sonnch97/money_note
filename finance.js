export const DEFAULT_ACCOUNT = { id: 'wallet-default', name: 'Ví chính', openingBalance: 0 };

export function accountBalance(state, accountId, asOf = '9999-12-31') {
  const account = (state.accounts || []).find((item) => item.id === accountId);
  if (!account) return 0;
  let balance = account.openingBalance || 0;
  for (const item of state.transactions || []) {
    if (item.date > asOf || (item.accountId || DEFAULT_ACCOUNT.id) !== accountId) continue;
    balance += item.type === 'income' ? item.amount : -item.amount;
  }
  for (const item of state.transfers || []) {
    if (item.date > asOf) continue;
    if (item.fromAccountId === accountId) balance -= item.amount;
    if (item.toAccountId === accountId) balance += item.amount;
  }
  return balance;
}

export function previousMonth(month) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function effectiveMonthlyBudget(state, month, depth = 0) {
  const entry = state.budgets?.[month] || {};
  const base = Number(entry.total) || 0;
  if (!entry.rollover || depth >= 120) return { base, carry: 0, limit: base };
  const previous = previousMonth(month);
  if (!state.budgets?.[previous]) return { base, carry: 0, limit: base };
  const previousLimit = effectiveMonthlyBudget(state, previous, depth + 1).limit;
  const previousSpent = (state.transactions || []).filter((item) => item.type === 'expense' && item.date.slice(0, 7) === previous).reduce((sum, item) => sum + item.amount, 0);
  const carry = Math.max(0, previousLimit - previousSpent);
  return { base, carry, limit: base + carry };
}

export function annualBudgetStatus(state, year) {
  const limit = Number(state.annualBudgets?.[year]) || 0;
  const spent = (state.transactions || []).filter((item) => item.type === 'expense' && item.date.slice(0, 4) === String(year)).reduce((sum, item) => sum + item.amount, 0);
  return { limit, spent, remaining: limit - spent };
}
