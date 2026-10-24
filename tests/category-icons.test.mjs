import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORY_ICON_OPTIONS, categoryIconSymbol, categoryIconValue, categoryIconsForType } from '../category-icons.js';

test('các icon mới đều có hình SVG và có lựa chọn riêng cho thu, chi', () => {
  const symbols = new Set([...readFileSync(new URL('../index.html', import.meta.url), 'utf8').matchAll(/id="icon-([a-z-]+)"/g)].map((match) => match[1]));
  assert.equal(new Set(CATEGORY_ICON_OPTIONS.map((option) => option.value)).size, CATEGORY_ICON_OPTIONS.length);
  for (const option of CATEGORY_ICON_OPTIONS) {
    assert.ok(symbols.has(option.symbol), `Thiếu SVG: ${option.symbol}`);
    assert.ok(option.value.length <= 16, `Mã icon quá dài để sao lưu: ${option.value}`);
  }
  assert.ok(categoryIconsForType('expense').some((option) => option.value === 'pets'));
  assert.ok(categoryIconsForType('income').some((option) => option.value === 'freelance'));
  assert.ok(categoryIconsForType('income').some((option) => option.value === 'gift'));
  assert.ok(!categoryIconsForType('expense').some((option) => option.value === 'salary'));
});

test('danh mục đã lưu với icon cũ vẫn hiển thị đúng và các mục mặc định có icon riêng', () => {
  assert.equal(categoryIconSymbol('◕', 'food'), 'food');
  assert.equal(categoryIconValue('✦', 'fun'), 'entertainment');
  assert.equal(categoryIconValue('✦', 'bonus'), 'gift');
  assert.equal(categoryIconValue('✦', 'custom'), 'sparkle');
  assert.equal(categoryIconValue('◈', 'other-income'), 'coins');
  assert.equal(categoryIconValue('↗', 'custom'), 'arrow');
  assert.equal(categoryIconSymbol('pets', 'custom'), 'pets');
});
