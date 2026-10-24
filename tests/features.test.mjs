import test from 'node:test';
import assert from 'node:assert/strict';
import { annualCategorySeries, annualReport, budgetAlerts, budgetComparison, dueRecurring, filterTransactions, monthlyExpenseDays, recurringOccurrence } from '../features.js';

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

test('báo cáo năm cộng thu chi đúng tháng và danh mục, không lẫn năm khác', () => {
  const sample = { transactions: [
    { id: '1', type: 'expense', categoryId: 'food', amount: 100000, date: '2026-01-31' },
    { id: '2', type: 'income', categoryId: 'salary', amount: 900000, date: '2026-01-01' },
    { id: '3', type: 'expense', categoryId: 'home', amount: 250000, date: '2026-12-01' },
    { id: '4', type: 'expense', categoryId: 'food', amount: 70000, date: '2025-12-31' },
  ] };
  const report = annualReport(sample, '2026');
  assert.deepEqual([report.incomeTotal, report.expenseTotal, report.transactions.length], [900000, 350000, 3]);
  assert.deepEqual([report.months[0].income, report.months[0].expense, report.months[11].expense], [900000, 100000, 250000]);
  assert.deepEqual(report.categories, [{ id: 'home', amount: 250000 }, { id: 'food', amount: 100000 }]);
  assert.equal(report.months.length, 12);
  assert.equal(report.months.slice(1, 11).every((item) => item.income === 0 && item.expense === 0), true);
  const empty = annualReport(sample, '2024');
  assert.equal(empty.expenseTotal, 0);
  assert.deepEqual(empty.categories, []);
});

test('lũy kế ngày và lịch nhiệt chỉ dùng khoản chi trong tháng, kể cả tháng hai nhuận', () => {
  const sample = { transactions: [
    { type: 'expense', amount: 100, date: '2024-02-01' },
    { type: 'expense', amount: 150, date: '2024-02-29' },
    { type: 'income', amount: 900, date: '2024-02-29' },
    { type: 'expense', amount: 500, date: '2024-03-01' },
  ] };
  const report = monthlyExpenseDays(sample, '2024-02');
  assert.equal(report.days.length, 29);
  assert.equal(report.offset, 3);
  assert.deepEqual([report.days[0].amount, report.days[1].cumulative, report.days[28].cumulative, report.total], [100, 100, 250, 250]);
});

test('cột chồng theo danh mục giữ đúng tổng tháng và gộp danh mục còn lại', () => {
  const sample = { transactions: [
    { type: 'expense', categoryId: 'a', amount: 400, date: '2026-01-02' },
    { type: 'expense', categoryId: 'b', amount: 200, date: '2026-01-03' },
    { type: 'expense', categoryId: 'c', amount: 100, date: '2026-02-02' },
    { type: 'income', categoryId: 'salary', amount: 800, date: '2026-02-03' },
  ] };
  const series = annualCategorySeries(sample, '2026', 2);
  assert.deepEqual(series.categories, [{ id: 'a', amount: 400 }, { id: 'b', amount: 200 }, { id: null, amount: 100 }]);
  assert.deepEqual(series.months[0].segments.map((item) => item.amount), [400, 200, 0]);
  assert.deepEqual(series.months[1].segments.map((item) => item.amount), [0, 0, 100]);
  assert.equal(series.months.flatMap((item) => item.segments).reduce((sum, item) => sum + item.amount, 0), 700);
});

test('so sánh ngân sách chỉ gồm giới hạn đã đặt và tính đúng thực chi', () => {
  const sample = { transactions: [
    { type: 'expense', categoryId: 'food', amount: 120, date: '2026-10-02' },
    { type: 'income', categoryId: 'salary', amount: 900, date: '2026-10-02' },
    { type: 'expense', categoryId: 'food', amount: 80, date: '2026-09-30' },
  ], budgets: { '2026-10': { total: 100, categories: { food: 100, home: 0 } } } };
  assert.deepEqual(budgetComparison(sample, '2026-10'), [{ id: null, limit: 100, spent: 120 }, { id: 'food', limit: 100, spent: 120 }]);
  assert.deepEqual(budgetComparison(sample, '2026-11'), []);
});
