export function findAmounts(text) {
  const found = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const normalized = line.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
    const priority = /(?:tong|thanh toan|can tra|phai tra|total|amount|so tien)/.test(normalized) ? 2 : /(?:vnd|vnđ|₫|\bdong\b)/.test(normalized) ? 1 : 0;
    for (const match of line.matchAll(/(?<![\d.,/:-])\d(?:[\d., ]*\d)?(?![\d.,/:-])/g)) {
      let raw = match[0].trim();
      if (/^\d{1,3}(?:[., ]\d{3})+(?:[.,]00)?$/.test(raw)) raw = raw.replace(/[.,]00$/, '').replace(/[., ]/g, '');
      else if (!/^\d+$/.test(raw)) continue;
      const amount = Number(raw);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 999999999999) continue;
      const existing = found.get(amount);
      if (!existing || existing.priority < priority) found.set(amount, { amount, priority });
    }
  }
  return [...found.values()].sort((a, b) => b.priority - a.priority || b.amount - a.amount).slice(0, 12).map(({ amount }) => amount);
}
