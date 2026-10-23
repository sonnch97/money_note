import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetAlerts, dueRecurring, filterTransactions, recurringOccurrence } from '../features.js';

const state = {
  categories: [{ id: 'food', name: 'Ăn uống', type: 'expense' }],
  transactions: [
    { id: 'a', type: 'expense', categoryId: 'food', amount: 80000, date: '2026-09-30', note: 'Bữa sáng' },
    { id: 'b', type: 'expense', categoryId: 'food', amount: 120000, date: '2026-10-02', note: 'Bữa tối' },
  ],
  budgets: { '2026-10': { total: 200000, categories: { food: 120000 } } },
  recurring: [{ id: 'rent', name: 'Tiền nhà', type: 'expense', amount: 2000000, categoryId: 'food', day: 31, startMonth: '2026-01', note: '', skippedMonths: [] }],
};

test('tìm mọi tháng và lọc khoảng ngày vẫn áp dụng danh mục, ghi chú', () => {
  assert.deepEqual(filterTransactions(state, { query: 'ăn uống' }).map((item) => item.id), ['a', 'b']);
  assert.deepEqual(filterTransactions(state, { period: 'month', month: '2026-10' }).map((item) => item.id), ['b']);
  assert.deepEqual(filterTransactions(state, { period: 'range', from: '2026-09-30', to: '2026-09-30' }).map((item) => item.id), ['a']);
});

test('cảnh báo ngân sách phân biệt 80% và 100%', () => {
  const alerts = budgetAlerts(state, '2026-10');
  assert.deepEqual(alerts.map((item) => [item.scope, item.level]), [['category', 'danger']]);
  state.transactions.push({ id: 'c', type: 'expense', categoryId: 'food', amount: 40000, date: '2026-10-10', note: '' });
  assert.equal(budgetAlerts(state, '2026-10').find((item) => item.scope === 'total').level, 'warning');
  state.transactions.pop();
});

test('khoản định kỳ ngày 31 dùng cuối tháng ngắn và không nhắc lại sau xác nhận hoặc bỏ qua', () => {
  const occurrence = recurringOccurrence(state.recurring[0], '2026-02');
  assert.equal(occurrence.date, '2026-02-28');
  assert.equal(dueRecurring(state, '2026-02', '2026-02-27').length, 0);
  assert.equal(dueRecurring(state, '2026-02', '2026-02-28').length, 1);
  state.transactions.push(occurrence);
  assert.equal(dueRecurring(state, '2026-02', '2026-02-28').length, 0);
  state.transactions.pop();
  state.recurring[0].skippedMonths.push('2026-02');
  assert.equal(dueRecurring(state, '2026-02', '2026-02-28').length, 0);
});
