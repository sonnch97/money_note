import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parseBackup } from '../backup.js';

const data = {
  transactions: [{ id: 't1', type: 'expense', amount: 125000, categoryId: 'food', date: '2026-10-23', note: 'Ăn trưa', createdAt: '2026-10-23T08:00:00.000Z' }],
  categories: [{ id: 'food', name: 'Ăn uống', type: 'expense', icon: '◕' }],
  budgets: { '2026-10': { total: 3000000, categories: { food: 800000 } } },
  templates: [{ id: 'p1', name: 'Ăn trưa', type: 'expense', amount: 125000, categoryId: 'food', note: 'Ăn trưa' }],
  recurring: [{ id: 'r1', name: 'Tiền nhà', type: 'expense', amount: 2500000, categoryId: 'food', note: '', day: 31, startMonth: '2026-10', skippedMonths: ['2026-11'] }],
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
  delete old.data.templates;
  delete old.data.recurring;
  assert.deepEqual(parseBackup(JSON.stringify(old)).data, { ...data, templates: [], recurring: [] });
});
