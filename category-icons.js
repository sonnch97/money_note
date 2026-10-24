export const CATEGORY_ICON_OPTIONS = [
  { value: 'food', label: 'Ăn uống', type: 'expense', symbol: 'food' },
  { value: 'coffee', label: 'Cà phê', type: 'expense', symbol: 'coffee' },
  { value: 'shopping', label: 'Mua sắm', type: 'expense', symbol: 'shopping' },
  { value: 'home', label: 'Nhà cửa', type: 'expense', symbol: 'home' },
  { value: 'bills', label: 'Hóa đơn', type: 'expense', symbol: 'bills' },
  { value: 'transport', label: 'Di chuyển', type: 'expense', symbol: 'transport' },
  { value: 'travel', label: 'Du lịch', type: 'expense', symbol: 'travel' },
  { value: 'health', label: 'Sức khỏe', type: 'expense', symbol: 'health' },
  { value: 'learning', label: 'Học tập', type: 'expense', symbol: 'learning' },
  { value: 'entertainment', label: 'Giải trí', type: 'expense', symbol: 'entertainment' },
  { value: 'pets', label: 'Thú cưng', type: 'expense', symbol: 'pets' },
  { value: 'phone', label: 'Điện thoại', type: 'expense', symbol: 'phone' },
  { value: 'sports', label: 'Thể thao', type: 'expense', symbol: 'sports' },
  { value: 'beauty', label: 'Làm đẹp', type: 'expense', symbol: 'beauty' },
  { value: 'subscription', label: 'Đăng ký', type: 'expense', symbol: 'subscription' },
  { value: 'salary', label: 'Lương', type: 'income', symbol: 'salary' },
  { value: 'freelance', label: 'Việc phụ', type: 'income', symbol: 'freelance' },
  { value: 'investment', label: 'Đầu tư', type: 'income', symbol: 'investment' },
  { value: 'refund', label: 'Hoàn tiền', type: 'income', symbol: 'refund' },
  { value: 'savings', label: 'Tiết kiệm', type: 'income', symbol: 'savings' },
  { value: 'coins', label: 'Thu khác', type: 'income', symbol: 'coins' },
  { value: 'gift', label: 'Quà tặng', type: 'both', symbol: 'gift' },
  { value: 'sparkle', label: 'Ngôi sao', type: 'both', symbol: 'sparkle' },
  { value: 'diamond', label: 'Hình thoi', type: 'both', symbol: 'diamond' },
  { value: 'circle', label: 'Hình tròn', type: 'both', symbol: 'circle' },
  { value: 'arrow', label: 'Mũi tên', type: 'both', symbol: 'arrow-up-right' },
  { value: 'other', label: 'Khác', type: 'both', symbol: 'more' },
];

const LEGACY_OPTIONS = {
  '◕': 'food', '▣': 'shopping', '⌂': 'home', '◎': 'transport',
  '✚': 'health', '♧': 'learning', '✦': 'sparkle', '◈': 'diamond',
  '●': 'circle', '↗': 'arrow',
};

const DEFAULT_UPGRADES = {
  fun: { from: '✦', to: 'entertainment' },
  'other-expense': { from: '◈', to: 'other' },
  salary: { from: '↗', to: 'salary' },
  bonus: { from: '✦', to: 'gift' },
  'other-income': { from: '◈', to: 'coins' },
};

const OPTION_BY_VALUE = new Map(CATEGORY_ICON_OPTIONS.map((option) => [option.value, option]));

export function categoryIconValue(value, categoryId) {
  const upgrade = DEFAULT_UPGRADES[categoryId];
  if (upgrade && value === upgrade.from) return upgrade.to;
  return LEGACY_OPTIONS[value] || value || 'other';
}

export function categoryIconSymbol(value, categoryId) {
  return OPTION_BY_VALUE.get(categoryIconValue(value, categoryId))?.symbol || null;
}

export function categoryIconsForType(type) {
  return CATEGORY_ICON_OPTIONS.filter((option) => option.type === 'both' || option.type === type);
}
