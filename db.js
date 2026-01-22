const DB_NAME = "vzdrzevanje_ook_db";
const DB_VER = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("entries")) {
        const store = db.createObjectStore("entries", { keyPath: "id" });
        store.createIndex("by_date", "createdAt");
        store.createIndex("by_machine", "machine");
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putEntry(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("entries", "readwrite");
    t.objectStore("entries").put(entry);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

export async function getAllEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("entries", "readonly");
    const req = t.objectStore("entries").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("entries", "readonly");
    const req = t.objectStore("entries").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("entries", "readwrite");
    t.objectStore("entries").delete(id);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

export async function wipeAll() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t1 = db.transaction("entries", "readwrite");
    t1.objectStore("entries").clear();
    t1.oncomplete = resolve;
    t1.onerror = () => reject(t1.error);
  });
  await new Promise((resolve, reject) => {
    const t2 = db.transaction("meta", "readwrite");
    t2.objectStore("meta").clear();
    t2.oncomplete = resolve;
    t2.onerror = () => reject(t2.error);
  });
}

export async function setMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("meta", "readwrite");
    t.objectStore("meta").put({ key, value });
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

export async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("meta", "readonly");
    const req = t.objectStore("meta").get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  });
}
