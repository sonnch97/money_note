import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseImportAmount, parseImportDate, prepareCsvImport } from '../csv-import.js';

test('CSV có BOM, dấu chấm phẩy, ô có xuống dòng và dấu nháy kép', () => {
  const parsed = parseCsv('\uFEFFNgày;Số tiền;Ghi chú\r\n23/10/2026;"1.250.000";"Mua ""sách""\ncho bé"\r\n');
  assert.deepEqual(parsed.headers, ['Ngày', 'Số tiền', 'Ghi chú']);
  assert.deepEqual(parsed.rows, [['23/10/2026', '1.250.000', 'Mua "sách"\ncho bé']]);
  assert.equal(parseImportDate('29/02/2024'), '2024-02-29');
  assert.equal(parseImportDate('29/02/2025'), null);
  assert.equal(parseImportAmount('(1,234,567.00)'), -1234567);
  assert.equal(parseImportAmount('1.234,50'), null);
});

test('xem trước CSV đánh dấu dòng trùng nhưng vẫn cho chọn lại', () => {
  const state = {
    categories: [{ id: 'food', name: 'Ăn uống', type: 'expense' }, { id: 'salary', name: 'Lương', type: 'income' }],
    transactions: [{ type: 'expense', amount: 50000, date: '2026-10-23', note: 'Cà phê', accountId: 'wallet-default' }],
  };
  const rows = [['23/10/2026', '50.000', 'Cà phê'], ['24/10/2026', '60.000', 'Ăn trưa'], ['sai ngày', '1.000', 'Lỗi']];
  const mapping = { date: '0', amount: '1', expense: '', income: '', type: '', category: '', note: '2', accountId: 'wallet-default', defaultType: 'expense', expenseCategoryId: 'food', incomeCategoryId: 'salary' };
  const preview = prepareCsvImport(rows, mapping, state);
  assert.equal(preview[0].duplicate, true);
  assert.equal(preview[1].item.amount, 60000);
  assert.match(preview[2].error, /không hợp lệ/);
});
