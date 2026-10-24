import test from 'node:test';
import assert from 'node:assert/strict';
import { MoneyNoteSync } from '../sync.js';
import { diffRecords, recordKey, stateFromRecords } from '../sync-data.js';
import { DEFAULT_ACCOUNT } from '../finance.js';

const defaults = [{ id: 'food', name: 'Ăn uống', type: 'expense', icon: '◕' }];
const empty = () => ({ transactions: [], categories: structuredClone(defaults), budgets: {}, templates: [], recurring: [] });
const transaction = (id, amount) => ({ id, type: 'expense', amount, categoryId: 'food', date: '2026-10-23', note: '', createdAt: '2026-10-23T00:00:00Z' });

function fakeStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

function fakeClient() {
  const rows = new Map();
  let writes = 0;
  return {
    rows,
    get writes() { return writes; },
    from() {
      const filters = [];
      let operation = null;
      return {
        select() {
          if (!operation) return this;
          if (operation.kind === 'insert') {
            const row = operation.row, key = recordKey(row.kind, row.record_id);
            if (rows.has(key)) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
            const saved = { ...row, version: 1 };
            rows.set(key, saved); writes++;
            return Promise.resolve({ data: [saved], error: null });
          }
          const matched = [...rows.values()].filter((row) => filters.every(([field, value]) => row[field] === value));
          const data = matched.map((row) => {
            const saved = { ...row, ...operation.row, version: row.version + 1 };
            rows.set(recordKey(row.kind, row.record_id), saved); writes++;
            return saved;
          });
          return Promise.resolve({ data, error: null });
        },
        eq(field, value) { filters.push([field, value]); return this; },
        order() { return this; },
        async range(from, to) { return { data: [...rows.values()].filter((row) => filters.every(([field, value]) => row[field] === value)).sort((a, b) => `${a.kind}:${a.record_id}`.localeCompare(`${b.kind}:${b.record_id}`)).slice(from, to + 1), error: null }; },
        insert(row) { operation = { kind: 'insert', row }; return this; },
        update(row) { operation = { kind: 'update', row }; return this; },
      };
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
  };
}

function controller(client, storage, stateRef, online = { value: true }, chooseInitialData = async () => 'merge') {
  return new MoneyNoteSync({ client, storage, defaults, getState: () => stateRef.value, acceptState: (next) => { stateRef.value = next; }, chooseInitialData, setStatus: () => {}, isOnline: () => online.value });
}

test('hai giao dịch khác nhau được ghi thành hai hàng, không đẩy cả sổ', async () => {
  const client = fakeClient(), storage = fakeStorage(), stateRef = { value: empty() };
  const sync = controller(client, storage, stateRef);
  await sync.start('user-1');
  const first = structuredClone(stateRef.value);
  stateRef.value.transactions.push(transaction('a', 12000));
  sync.queueChanges(diffRecords(first, stateRef.value));
  await sync.syncNow();
  const second = structuredClone(stateRef.value);
  stateRef.value.transactions.push(transaction('b', 34000));
  sync.queueChanges(diffRecords(second, stateRef.value));
  await sync.syncNow();
  assert.equal(client.rows.get(recordKey('transaction', 'a')).payload.amount, 12000);
  assert.equal(client.rows.get(recordKey('transaction', 'b')).payload.amount, 34000);
  assert.equal(client.rows.size, 3); // hai giao dịch và một danh mục
  sync.stop();
});

test('thay đổi ngoại tuyến nằm trong hàng đợi và được gửi khi có mạng', async () => {
  const client = fakeClient(), storage = fakeStorage(), stateRef = { value: empty() }, online = { value: true };
  const sync = controller(client, storage, stateRef, online);
  await sync.start('user-1');
  online.value = false;
  const before = structuredClone(stateRef.value);
  stateRef.value.transactions.push(transaction('offline', 56000));
  sync.queueChanges(diffRecords(before, stateRef.value));
  await sync.syncNow();
  assert.equal(client.rows.has(recordKey('transaction', 'offline')), false);
  assert.equal(JSON.parse(storage.getItem('moneynote.sync.queue.user-1')).length, 1);
  online.value = true;
  await sync.syncNow();
  assert.equal(client.rows.get(recordKey('transaction', 'offline')).payload.amount, 56000);
  assert.equal(JSON.parse(storage.getItem('moneynote.sync.queue.user-1')).length, 0);
  sync.stop();
});

test('xóa tạo tombstone và không làm mục cũ hiện lại', () => {
  const before = { ...empty(), transactions: [transaction('gone', 12000)] };
  const changes = diffRecords(before, empty());
  assert.equal(changes.length, 1);
  assert.equal(changes[0].deleted, true);
  const result = stateFromRecords([{ ...changes[0], deleted: false, payload: before.transactions[0] }], changes, defaults);
  assert.equal(result.transactions.length, 0);
});

test('ngân sách tháng và theo danh mục là hai hàng riêng', () => {
  const next = empty();
  next.budgets['2026-10'] = { total: 1000000, categories: { food: 200000 } };
  const changes = diffRecords(empty(), next);
  assert.deepEqual(changes.map((row) => row.kind).sort(), ['budget_total', 'category_budget']);
});

test('ví, chuyển tiền, mục tiêu và ngân sách năm dùng các loại bản ghi Supabase hiện có', () => {
  const before = empty(), next = { ...empty(), accounts: [DEFAULT_ACCOUNT], transfers: [{ id: 'move', fromAccountId: 'wallet-default', toAccountId: 'bank', amount: 20000, date: '2026-10-23', note: '' }], goals: [{ id: 'goal', name: 'Dự phòng', targetAmount: 1000000, savedAmount: 200000, deadline: '' }], annualBudgets: { '2026': 9000000 } };
  const changes = diffRecords(before, next);
  assert.deepEqual(changes.map((row) => [row.kind, row.record_id]), [['transaction', 'move'], ['category', 'wallet-default'], ['template', 'goal'], ['budget_total', 'year:2026']]);
  const restored = stateFromRecords(changes, [], defaults);
  assert.deepEqual(restored.accounts, [DEFAULT_ACCOUNT]);
  assert.deepEqual(restored.transfers, next.transfers);
  assert.deepEqual(restored.goals, next.goals);
  assert.deepEqual(restored.annualBudgets, next.annualBudgets);
});

test('dữ liệu đám mây cũ tự có Ví chính cho giao dịch chưa gán ví', () => {
  const old = transaction('old', 10000);
  const restored = stateFromRecords([{ kind: 'transaction', record_id: old.id, payload: old, deleted: false }], [], defaults);
  assert.deepEqual(restored.accounts, [DEFAULT_ACCOUNT]);
  assert.equal(restored.transactions[0].accountId, undefined);
});

test('gộp lần đầu chỉ gửi mục chưa có, vẫn giữ giao dịch trên đám mây', async () => {
  const client = fakeClient(), storage = fakeStorage();
  client.rows.set(recordKey('transaction', 'remote'), { user_id: 'user-1', kind: 'transaction', record_id: 'remote', payload: transaction('remote', 10000), deleted: false, version: 1 });
  const stateRef = { value: { ...empty(), transactions: [transaction('local', 20000)] } };
  const sync = controller(client, storage, stateRef);
  await sync.start('user-1');
  assert.deepEqual(stateRef.value.transactions.map((item) => item.id).sort(), ['local', 'remote']);
  assert.equal(client.rows.get(recordKey('transaction', 'remote')).payload.amount, 10000);
  assert.equal(client.rows.get(recordKey('transaction', 'local')).payload.amount, 20000);
  sync.stop();
});

test('đổi tài khoản không tự tải dữ liệu cũ lên đám mây rỗng', async () => {
  const client = fakeClient(), storage = fakeStorage();
  storage.setItem('moneynote.sync.owner', 'other-user');
  const stateRef = { value: { ...empty(), transactions: [transaction('private', 99000)] } };
  let prompted = false;
  const sync = controller(client, storage, stateRef, { value: true }, async (_local, _rows, context) => { prompted = context.differentAccount; return 'cloud'; });
  await sync.start('user-1');
  assert.equal(prompted, true);
  assert.equal(client.rows.size, 0);
  assert.equal(stateRef.value.transactions.length, 0);
  sync.stop();
});

test('hai thiết bị sửa cùng giao dịch sẽ dừng và cho chọn bản giữ lại', async () => {
  const client = fakeClient();
  const firstState = { value: empty() }, secondState = { value: empty() };
  const first = controller(client, fakeStorage(), firstState);
  const secondOnline = { value: true };
  const second = controller(client, fakeStorage(), secondState, secondOnline);
  await first.start('user-1');
  const initial = structuredClone(firstState.value);
  firstState.value.transactions.push(transaction('shared', 10000));
  first.queueChanges(diffRecords(initial, firstState.value));
  await first.syncNow();
  await second.start('user-1');
  assert.equal(secondState.value.transactions[0].amount, 10000);

  secondOnline.value = false;
  const beforeSecond = structuredClone(secondState.value);
  secondState.value.transactions[0].amount = 20000;
  second.queueChanges(diffRecords(beforeSecond, secondState.value));
  const beforeFirst = structuredClone(firstState.value);
  firstState.value.transactions[0].amount = 30000;
  first.queueChanges(diffRecords(beforeFirst, firstState.value));
  await first.syncNow();
  secondOnline.value = true;
  await second.syncNow();
  assert.equal(second.getConflicts().length, 1);
  assert.equal(secondState.value.transactions[0].amount, 20000);
  assert.equal(client.rows.get(recordKey('transaction', 'shared')).payload.amount, 30000);

  second.resolveConflict(second.getConflicts()[0].key, 'remote');
  assert.equal(secondState.value.transactions[0].amount, 30000);
  assert.equal(second.getConflicts().length, 0);
  first.stop(); second.stop();
});

test('chọn bản trên thiết bị ghi lên phiên bản mới nhất', async () => {
  const client = fakeClient();
  const firstState = { value: empty() }, secondState = { value: empty() };
  const first = controller(client, fakeStorage(), firstState);
  const secondOnline = { value: true };
  const second = controller(client, fakeStorage(), secondState, secondOnline);
  await first.start('user-1');
  const original = structuredClone(firstState.value);
  firstState.value.transactions.push(transaction('shared', 10000));
  first.queueChanges(diffRecords(original, firstState.value));
  await first.syncNow();
  await second.start('user-1');
  secondOnline.value = false;
  const oldSecond = structuredClone(secondState.value);
  secondState.value.transactions[0].amount = 20000;
  second.queueChanges(diffRecords(oldSecond, secondState.value));
  const oldFirst = structuredClone(firstState.value);
  firstState.value.transactions[0].amount = 30000;
  first.queueChanges(diffRecords(oldFirst, firstState.value));
  await first.syncNow();
  secondOnline.value = true;
  await second.syncNow();
  second.resolveConflict(second.getConflicts()[0].key, 'local');
  await second.syncNow();
  assert.equal(client.rows.get(recordKey('transaction', 'shared')).payload.amount, 20000);
  assert.equal(second.getConflicts().length, 0);
  first.stop(); second.stop();
});
