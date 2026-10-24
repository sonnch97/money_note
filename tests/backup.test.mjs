import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parseBackup } from '../backup.js';
import { DEFAULT_ACCOUNT } from '../finance.js';

const data = {
  transactions: [{ id: 't1', type: 'expense', amount: 125000, categoryId: 'food', accountId: DEFAULT_ACCOUNT.id, date: '2026-10-23', note: 'Ăn trưa', createdAt: '2026-10-23T08:00:00.000Z' }],
  categories: [{ id: 'food', name: 'Ăn uống', type: 'expense', icon: '◕' }],
  budgets: { '2026-10': { total: 3000000, categories: { food: 800000 }, rollover: true } },
  templates: [{ id: 'p1', name: 'Ăn trưa', type: 'expense', amount: 125000, categoryId: 'food', note: 'Ăn trưa' }],
  recurring: [{ id: 'r1', name: 'Tiền nhà', type: 'expense', amount: 2500000, categoryId: 'food', note: '', day: 31, startMonth: '2026-10', skippedMonths: ['2026-11'] }],
  accounts: [DEFAULT_ACCOUNT, { id: 'bank', name: 'Ngân hàng', openingBalance: 5000000 }],
  transfers: [{ id: 'x1', fromAccountId: DEFAULT_ACCOUNT.id, toAccountId: 'bank', amount: 100000, date: '2026-10-24', note: '' }],
  goals: [{ id: 'g1', name: 'Dự phòng', targetAmount: 10000000, savedAmount: 2000000, deadline: '2027-12-31' }],
  annualBudgets: { '2026': 50000000 },
};

test('sao lưu rồi khôi phục giữ nguyên toàn bộ giao dịch, ngân sách, mẫu và lịch định kỳ', () => {
  const restored = parseBackup(createBackup(data));
  assert.deepEqual(restored.data, data);
  assert.deepEqual(parseBackup(`\uFEFF${createBackup(data)}`).data, data);
  assert.ok(!Number.isNaN(Date.parse(restored.exportedAt)));
});

test('tệp lỗi hoặc thiếu một phần dữ liệu bị từ chối', () => {
  assert.throws(() => parseBackup('{'), /không phải JSON/);
  const backup = JSON.parse(createBackup(data));
  delete backup.data.budgets;
  assert.throws(() => parseBackup(JSON.stringify(backup)), /thiếu giao dịch, danh mục hoặc ngân sách/);
  backup.data.budgets = data.budgets;
  backup.data.transactions[0].amount = -1;
  assert.throws(() => parseBackup(JSON.stringify(backup)), /giao dịch bị lỗi/);
});

test('bản sao lưu phiên bản 1 vẫn đọc được với các tính năng mới để trống', () => {
  const old = JSON.parse(createBackup(data));
  old.version = 1;
  delete old.data.accounts; delete old.data.transfers; delete old.data.goals; delete old.data.annualBudgets;
  delete old.data.templates;
  delete old.data.recurring;
  delete old.data.transactions[0].accountId;
  delete old.data.budgets['2026-10'].rollover;
  const restored = parseBackup(JSON.stringify(old)).data;
  assert.deepEqual(restored, { ...old.data, templates: [], recurring: [], accounts: [DEFAULT_ACCOUNT], transfers: [], goals: [], annualBudgets: {} });
});

test('bản sao lưu phiên bản 2 cũng được nâng cấp lên Ví chính', () => {
  const old = JSON.parse(createBackup(data));
  old.version = 2;
  delete old.data.accounts; delete old.data.transfers; delete old.data.goals; delete old.data.annualBudgets;
  delete old.data.transactions[0].accountId;
  const restored = parseBackup(JSON.stringify(old)).data;
  assert.deepEqual(restored.accounts, [DEFAULT_ACCOUNT]);
  assert.deepEqual(restored.transfers, []);
  assert.equal(restored.transactions[0].accountId, undefined);
});
