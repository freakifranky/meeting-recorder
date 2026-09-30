function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('interviews', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('recs', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction('recs', mode);
    const req = fn(t.objectStore('recs'));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
const dbPut = rec => tx('readwrite', s => s.put(rec));
const dbGet = id => tx('readonly', s => s.get(id));
const dbAll = () => tx('readonly', s => s.getAll());
const dbDel = id => tx('readwrite', s => s.delete(id));
