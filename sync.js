import { diffRecords, hasPersonalData, mergeUniqueRecords, recordKey, recordsOf, stateFromRecords } from './sync-data.js';

const TABLE = 'moneynote_records';
const OWNER_KEY = 'moneynote.sync.owner';
export const LOCAL_DIRTY_KEY = 'moneynote.sync.local-dirty';
const queueKey = (userId) => `moneynote.sync.queue.${userId}`;

export class MoneyNoteSync {
  constructor({ client, storage, defaults, getState, acceptState, chooseInitialData, setStatus, onConflicts = () => {}, isOnline = () => navigator.onLine }) {
    Object.assign(this, { client, storage, defaults, getState, acceptState, chooseInitialData, setStatus, onConflicts, isOnline });
    this.queue = new Map();
    this.remoteRows = new Map();
    this.conflicts = new Map();
    this.revision = 0;
    this.active = false;
    this.userId = null;
    this.generation = 0;
  }

  readQueue(userId) {
    try {
      const rows = JSON.parse(this.storage.getItem(queueKey(userId)) || '[]');
      return new Map(rows.filter((row) => row && typeof row.kind === 'string' && typeof row.record_id === 'string').map((row) => [recordKey(row.kind, row.record_id), row]));
    } catch { return new Map(); }
  }

  persistQueue() {
    this.storage.setItem(queueKey(this.userId), JSON.stringify([...this.queue.values()]));
    this.setStatus(this.conflicts.size ? `${this.conflicts.size} mục cần chọn bản giữ lại` : this.queue.size ? `Chờ đồng bộ ${this.queue.size} thay đổi` : 'Đã đồng bộ');
  }

  queueChanges(changes) {
    if (!this.active || !changes.length) return;
    for (const row of changes) {
      const key = recordKey(row.kind, row.record_id);
      const baseVersion = this.queue.get(key)?.baseVersion ?? this.remoteRows.get(key)?.version ?? 0;
      this.queue.set(key, { ...row, baseVersion });
    }
    this.revision++;
    try { this.persistQueue(); } catch { this.setStatus('Không thể lưu hàng đợi đồng bộ trên thiết bị'); return; }
    this.scheduleSync(700);
  }

  async fetchRows() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.client.from(TABLE).select('kind,record_id,payload,deleted,version').eq('user_id', this.userId).order('kind').order('record_id').range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }

  async start(userId) {
    if (this.userId === userId && this.active) return this.syncNow();
    this.stop();
    const generation = this.generation;
    this.userId = userId;
    this.queue = this.readQueue(userId);
    this.setStatus('Đang đọc dữ liệu đám mây…');
    try {
      const rows = await this.fetchRows();
      if (generation !== this.generation) return;
      this.remoteRows = new Map(rows.map((row) => [recordKey(row.kind, row.record_id), row]));
      for (const [key, row] of this.queue) {
        if (!Number.isSafeInteger(row.baseVersion)) this.queue.set(key, { ...row, baseVersion: this.remoteRows.has(key) ? -1 : 0 });
      }
      const local = this.getState();
      const previousOwner = this.storage.getItem(OWNER_KEY);
      const knownOwner = previousOwner === userId;
      const localDirty = this.storage.getItem(LOCAL_DIRTY_KEY) === '1';
      const needsChoice = hasPersonalData(local, this.defaults) && (localDirty || (rows.length ? !knownOwner : !!previousOwner && !knownOwner));
      if (needsChoice) {
        const choice = await this.chooseInitialData(local, rows, { differentAccount: !!previousOwner && !knownOwner });
        if (generation !== this.generation) return;
        if (choice === 'cancel') { this.setStatus('Chưa kết nối đồng bộ'); return; }
        if (choice === 'merge') {
          for (const row of mergeUniqueRecords(rows, local)) this.queue.set(recordKey(row.kind, row.record_id), { ...row, baseVersion: 0 });
        }
      } else if (!rows.length && !this.queue.size) {
        for (const row of recordsOf(local).values()) this.queue.set(recordKey(row.kind, row.record_id), { ...row, deleted: false, baseVersion: 0 });
      }
      this.storage.setItem(OWNER_KEY, userId);
      this.storage.removeItem(LOCAL_DIRTY_KEY);
      this.active = true;
      this.persistQueue();
      this.subscribe();
      await this.syncNow();
    } catch (error) {
      if (generation === this.generation) this.setStatus(`Lỗi đồng bộ: ${error.message || 'không thể kết nối'}`);
    }
  }

  subscribe() {
    this.channel = this.client.channel(`moneynote:${this.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${this.userId}` }, () => this.scheduleSync(250))
      .subscribe();
  }

  scheduleSync(delay = 0) {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.syncNow(); }, delay);
  }

  async syncNow() {
    if (!this.active || !this.isOnline()) { if (this.active) this.setStatus(`Ngoại tuyến${this.queue.size ? ` · ${this.queue.size} thay đổi chờ gửi` : ''}`); return; }
    if (this.syncPromise) { this.resync = true; return this.syncPromise; }
    const generation = this.generation;
    const run = (async () => {
      try {
        this.setStatus('Đang đồng bộ…');
        for (const [key, row] of [...this.queue]) {
          if (generation !== this.generation) return;
          if (this.conflicts.has(key)) continue;
          let response;
          if (row.baseVersion === 0) {
            response = await this.client.from(TABLE).insert({ user_id: this.userId, kind: row.kind, record_id: row.record_id, payload: row.payload, deleted: row.deleted }).select('kind,record_id,payload,deleted,version');
            if (response.error?.code === '23505') { this.conflicts.set(key, true); continue; }
          } else if (row.baseVersion > 0) {
            response = await this.client.from(TABLE).update({ payload: row.payload, deleted: row.deleted })
              .eq('user_id', this.userId).eq('kind', row.kind).eq('record_id', row.record_id).eq('version', row.baseVersion)
              .select('kind,record_id,payload,deleted,version');
          } else { this.conflicts.set(key, true); continue; }
          if (response.error) throw response.error;
          const saved = response.data?.[0];
          if (!saved) { this.conflicts.set(key, true); continue; }
          this.remoteRows.set(key, saved);
          if (this.queue.get(key) === row) this.queue.delete(key);
          else this.queue.set(key, { ...this.queue.get(key), baseVersion: saved.version });
          this.persistQueue();
        }
        if (generation !== this.generation) return;
        const revision = this.revision;
        const rows = await this.fetchRows();
        if (generation !== this.generation) return;
        this.remoteRows = new Map(rows.map((row) => [recordKey(row.kind, row.record_id), row]));
        for (const [key, row] of this.queue) {
          const remoteVersion = this.remoteRows.get(key)?.version ?? 0;
          if (row.baseVersion !== remoteVersion) this.conflicts.set(key, true);
        }
        if (revision !== this.revision) { this.resync = true; return; }
        this.acceptState(stateFromRecords(rows, [...this.queue.values()], this.defaults));
        this.onConflicts(this.getConflicts());
        this.persistQueue();
      } catch (error) {
        if (generation === this.generation) this.setStatus(`Lỗi đồng bộ: ${error.message || 'không thể kết nối'}`);
      }
    })();
    this.syncPromise = run;
    try { await run; }
    finally {
      if (this.syncPromise === run) this.syncPromise = null;
      if (this.resync && generation === this.generation) { this.resync = false; this.scheduleSync(0); }
    }
  }

  getConflicts() {
    return [...this.conflicts.keys()].filter((key) => this.queue.has(key)).map((key) => ({ key, local: this.queue.get(key), remote: this.remoteRows.get(key) || null }));
  }

  resolveConflict(key, choice) {
    if (!this.active || !this.conflicts.has(key) || !['local', 'remote'].includes(choice)) return;
    const remote = this.remoteRows.get(key);
    if (choice === 'remote') {
      this.queue.delete(key);
      this.acceptState(stateFromRecords([...this.remoteRows.values()], [...this.queue.values()], this.defaults));
    } else {
      this.queue.set(key, { ...this.queue.get(key), baseVersion: remote?.version ?? 0 });
    }
    this.conflicts.delete(key);
    this.revision++;
    this.persistQueue();
    this.onConflicts(this.getConflicts());
    this.scheduleSync(0);
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = null;
    this.active = false;
    this.userId = null;
    this.queue = new Map();
    this.remoteRows = new Map();
    this.conflicts = new Map();
    this.syncPromise = null;
    this.resync = false;
  }

  signOut() {
    this.stop();
    this.setStatus('Chỉ lưu trên thiết bị');
  }
}

export { diffRecords };
