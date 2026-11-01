import test from 'node:test';
import assert from 'node:assert/strict';
import { findAmounts } from '../image-amount.js';

test('ưu tiên tổng tiền và xử lý cách viết VND trên hóa đơn', () => {
  assert.deepEqual(findAmounts('Cà phê 45.000\nTổng thanh toán: 125.000 đ\nNgày 02/11/2026'), [125000, 45000]);
  assert.deepEqual(findAmounts('TOTAL 1,250,000.00 VND\nTiền mặt 2.000.000'), [1250000, 2000000]);
});

test('bỏ số không hợp lệ, trùng lặp và số vượt giới hạn', () => {
  assert.deepEqual(findAmounts('0\nTổng: 25.000\n25.000\n9999999999999'), [25000]);
});
