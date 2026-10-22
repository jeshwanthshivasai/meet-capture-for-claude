// Everything captured is kept in IndexedDB inside the extension (database "meet-capture"), on this computer.
// Used by the service worker, the captures page and the offscreen page. Snapshots are stored as bytes.
(function (root) {
  const NS = (root.MCC = root.MCC || {});
  const DB_NAME = 'meet-capture', DB_VERSION = 2;
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('meetings')) db.createObjectStore('meetings', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
        if (!db.objectStoreNames.contains('lines')) db.createObjectStore('lines', { keyPath: 'key' }).createIndex('meetingId', 'meetingId');
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'key' }).createIndex('meetingId', 'meetingId');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' }); // small things such as the folder you save to
      };
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
      r.onerror = () => { opening = null; reject(r.error || new Error('IndexedDB failed to open')); };
      r.onblocked = () => reject(new Error('IndexedDB is blocked by another open page'));
    });
    return opening;
  }
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const done = (t) => new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('transaction aborted')); });
  const lineKey = (meetingId, id) => `${meetingId}:${String(id).padStart(6, '0')}`;

  /** The meeting record without the heavy parts, for lists. */
  function summary(m) { return m; }

  const store = {
    async putMeeting(m) { const db = await open(); const t = db.transaction('meetings', 'readwrite'); t.objectStore('meetings').put(m); await done(t); return m; },
    async getMeeting(id) { const db = await open(); return req(db.transaction('meetings').objectStore('meetings').get(id)); },
    async updateMeeting(id, patch) {
      const db = await open(); const t = db.transaction('meetings', 'readwrite'); const s = t.objectStore('meetings');
      const m = await req(s.get(id)); if (!m) return null;
      const next = typeof patch === 'function' ? patch(m) : Object.assign(m, patch);
      s.put(next); await done(t); return next;
    },
    async listMeetings(limit = 100) {
      const db = await open(); const all = await req(db.transaction('meetings').objectStore('meetings').getAll());
      all.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      return all.slice(0, limit).map(summary);
    },
    async putLines(meetingId, lines) {
      const db = await open(); const t = db.transaction('lines', 'readwrite'); const s = t.objectStore('lines');
      for (const l of lines) s.put({ key: lineKey(meetingId, l.id), meetingId, id: String(l.id), speaker: l.speaker, text: l.text, startedAt: l.startedAt, updatedAt: l.updatedAt, final: !!l.final, split: !!l.split });
      await done(t);
    },
    async getLines(meetingId) {
      const db = await open(); const all = await req(db.transaction('lines').objectStore('lines').index('meetingId').getAll(meetingId));
      all.sort((a, b) => (a.startedAt - b.startedAt) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
      return all;
    },
    async countLines(meetingId) { const db = await open(); return req(db.transaction('lines').objectStore('lines').index('meetingId').count(meetingId)); },
    async putSnapshot(meetingId, snap) {
      const db = await open(); const t = db.transaction('snapshots', 'readwrite');
      const key = `${meetingId}:${snap.takenAt}`;
      t.objectStore('snapshots').put({ key, meetingId, takenAt: snap.takenAt, reason: snap.reason, source: snap.source, width: snap.width, height: snap.height, format: snap.format, bytes: snap.bytes, thumb: snap.thumb });
      await done(t); return key;
    },
    async getSnapshots(meetingId, { withData = false } = {}) {
      const db = await open(); const all = await req(db.transaction('snapshots').objectStore('snapshots').index('meetingId').getAll(meetingId));
      all.sort((a, b) => a.takenAt - b.takenAt);
      return withData ? all : all.map(({ bytes, ...rest }) => ({ ...rest, size: bytes ? bytes.byteLength : 0 }));
    },
    async getSnapshot(key) { const db = await open(); return req(db.transaction('snapshots').objectStore('snapshots').get(key)); },
    async countSnapshots(meetingId) { const db = await open(); return req(db.transaction('snapshots').objectStore('snapshots').index('meetingId').count(meetingId)); },
    async deleteMeeting(id) {
      const db = await open(); const t = db.transaction(['meetings', 'lines', 'snapshots'], 'readwrite');
      t.objectStore('meetings').delete(id);
      for (const name of ['lines', 'snapshots']) {
        const idx = t.objectStore(name).index('meetingId');
        const keys = await req(idx.getAllKeys(id));
        for (const k of keys) t.objectStore(name).delete(k);
      }
      await done(t);
    },
    /** Remove meetings that ended more than `days` days ago. Returns how many were removed. */
    async prune(days) {
      if (!days || days <= 0) return 0;
      const cutoff = Date.now() - days * 86400e3;
      const old = (await store.listMeetings(1000)).filter((m) => (m.endedAt || m.startedAt) < cutoff && m.status !== 'live');
      for (const m of old) await store.deleteMeeting(m.id);
      return old.length;
    },
    async getKV(key) { const db = await open(); const r = await req(db.transaction('kv').objectStore('kv').get(key)); return r ? r.value : undefined; },
    async setKV(key, value) { const db = await open(); const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put({ key, value }); await done(t); },
    async deleteKV(key) { const db = await open(); const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(key); await done(t); },
    async usage() {
      const db = await open();
      const snaps = await req(db.transaction('snapshots').objectStore('snapshots').getAll());
      return { bytes: snaps.reduce((s, x) => s + (x.bytes ? x.bytes.byteLength : 0), 0), snapshots: snaps.length };
    },
  };

  /** data:image/png;base64,... → Uint8Array */
  NS.dataUrlToBytes = (dataUrl) => {
    const comma = dataUrl.indexOf(',');
    const bin = atob(dataUrl.slice(comma + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  NS.store = store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
