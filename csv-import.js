export function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiters = [',', ';', '\t'];
  const countOutsideQuotes = (delimiter) => {
    let quoted = false, count = 0;
    for (let index = 0; index < firstLine.length; index++) {
      if (firstLine[index] === '"') quoted = !quoted;
      else if (!quoted && firstLine[index] === delimiter) count++;
    }
    return count;
  };
  const delimiter = delimiters.sort((a, b) => countOutsideQuotes(b) - countOutsideQuotes(a))[0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error('CSV có dấu ngoặc kép chưa đóng');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2 || rows[0].length < 2) throw new Error('CSV cần có hàng tiêu đề và ít nhất một giao dịch');
  if (rows.length > 2001) throw new Error('CSV chỉ hỗ trợ tối đa 2.000 dòng mỗi lần nhập');
  return { headers: rows[0].map((value) => value.trim()), rows: rows.slice(1) };
}

export function parseImportDate(value) {
  const text = String(value || '').trim();
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s|T|$)/.exec(text);
  if (!match) {
    match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s|$)/.exec(text);
    if (!match) return null;
    match = [match[0], match[3], match[2], match[1]];
  }
  const date = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function parseImportAmount(value) {
  let text = String(value ?? '').trim().replace(/[\s₫VNDđ]/gi, '');
  if (!text) return null;
  const negative = text.startsWith('-') || /^\(.*\)$/.test(text);
  text = text.replace(/^[+\-(]|\)$/g, '');
  if (/[.,]\d{2}$/.test(text)) {
    if (!/[.,]00$/.test(text)) return null;
    text = text.slice(0, -3);
  }
  if (!/^\d{1,3}(?:[.,]\d{3})*$/.test(text) && !/^\d+$/.test(text)) return null;
  const amount = Number(text.replace(/[.,]/g, ''));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 999999999999 ? (negative ? -amount : amount) : null;
}

const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('vi').replace(/\s+/g, ' ');
export const importFingerprint = (item) => [item.date, item.type, item.amount, item.accountId, normalize(item.note)].join('|');

export function prepareCsvImport(rows, mapping, state) {
  const existing = new Set((state.transactions || []).map((item) => importFingerprint({ ...item, accountId: item.accountId || 'wallet-default' })));
  const seen = new Set(existing);
  return rows.map((row, index) => {
    const cell = (column) => column === '' || column === undefined ? '' : (row[Number(column)] || '').trim();
    const date = parseImportDate(cell(mapping.date));
    const amountCell = mapping.amount !== '' ? parseImportAmount(cell(mapping.amount)) : null;
    const expenseCell = mapping.expense !== '' ? parseImportAmount(cell(mapping.expense)) : null;
    const incomeCell = mapping.income !== '' ? parseImportAmount(cell(mapping.income)) : null;
    const typeText = normalize(cell(mapping.type));
    const explicitType = /^(chi|expense|debit|withdrawal|out)$/.test(typeText) ? 'expense' : /^(thu|income|credit|deposit|in)$/.test(typeText) ? 'income' : null;
    let type = explicitType || mapping.defaultType;
    let amount = amountCell === null ? null : Math.abs(amountCell);
    if (mapping.amount === '') {
      if (expenseCell !== null && incomeCell !== null) return { index, error: 'Có cả cột thu và chi' };
      type = expenseCell !== null ? 'expense' : incomeCell !== null ? 'income' : type;
      amount = Math.abs(expenseCell ?? incomeCell ?? 0) || null;
    } else if (!explicitType && type === 'auto') type = amountCell < 0 ? 'expense' : 'income';
    if (!date || !amount || !['income', 'expense'].includes(type)) return { index, error: 'Ngày, loại hoặc số tiền không hợp lệ' };
    const categoryName = normalize(cell(mapping.category));
    const category = state.categories.find((item) => item.type === type && normalize(item.name) === categoryName);
    const categoryId = category?.id || (type === 'expense' ? mapping.expenseCategoryId : mapping.incomeCategoryId);
    if (!state.categories.some((item) => item.id === categoryId && item.type === type)) return { index, error: 'Chưa chọn danh mục phù hợp' };
    const item = { type, amount, categoryId, date, note: cell(mapping.note).slice(0, 120), accountId: mapping.accountId };
    const fingerprint = importFingerprint(item);
    const duplicate = seen.has(fingerprint);
    seen.add(fingerprint);
    return { index, item, duplicate };
  });
}
