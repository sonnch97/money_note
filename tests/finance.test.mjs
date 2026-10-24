import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ACCOUNT, accountBalance, annualBudgetStatus, effectiveMonthlyBudget } from '../finance.js';

test('số dư từng ví tính giao dịch cũ, chuyển tiền và bỏ giao dịch tương lai', () => {
  const state = {
    accounts: [DEFAULT_ACCOUNT, { id: 'bank', name: 'Ngân hàng', openingBalance: 500000 }],
    transactions: [
      { type: 'income', amount: 100000, date: '2026-10-01' },
      { type: 'expense', amount: 25000, accountId: 'bank', date: '2026-10-02' },
      { type: 'expense', amount: 900000, accountId: 'bank', date: '2026-11-01' },
    ],
    transfers: [{ fromAccountId: DEFAULT_ACCOUNT.id, toAccountId: 'bank', amount: 40000, date: '2026-10-03' }],
  };
  assert.equal(accountBalance(state, DEFAULT_ACCOUNT.id, '2026-10-25'), 60000);
  assert.equal(accountBalance(state, 'bank', '2026-10-25'), 515000);
  assert.equal(accountBalance(state, DEFAULT_ACCOUNT.id, '2026-10-25') + accountBalance(state, 'bank', '2026-10-25'), 575000);
});

test('chuyển dư chỉ cộng phần chưa dùng và ngân sách năm chỉ tính khoản chi', () => {
  const state = {
    budgets: {
      '2026-08': { total: 1000, categories: {} },
      '2026-09': { total: 1000, categories: {}, rollover: true },
      '2026-10': { total: 1000, categories: {}, rollover: true },
    },
    annualBudgets: { '2026': 4000 },
    transactions: [
      { type: 'expense', amount: 700, date: '2026-08-02' },
      { type: 'expense', amount: 1500, date: '2026-09-02' },
      { type: 'income', amount: 2000, date: '2026-10-01' },
      { type: 'expense', amount: 100, date: '2025-10-01' },
    ],
  };
  assert.deepEqual(effectiveMonthlyBudget(state, '2026-09'), { base: 1000, carry: 300, limit: 1300 });
  assert.deepEqual(effectiveMonthlyBudget(state, '2026-10'), { base: 1000, carry: 0, limit: 1000 });
  assert.deepEqual(annualBudgetStatus(state, '2026'), { limit: 4000, spent: 2200, remaining: 1800 });
});
