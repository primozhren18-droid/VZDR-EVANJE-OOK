const DB_NAME = "vzdrzevanje_ook_db";
const DB_VER = 4;

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

      // Izmene
      if (!db.objectStoreNames.contains("shifts")) {
        const s = db.createObjectStore("shifts", { keyPath: "id" });
        s.createIndex("by_date", "startAt");
      }

      // Obiski strojev
      if (!db.objectStoreNames.contains("visits")) {
        const v = db.createObjectStore("visits", { keyPath: "id" });
        v.createIndex("by_shift", "shiftId");
        v.createIndex("by_machine", "machine");
        v.createIndex("by_date", "startAt");
      }

      // Servisi / preventiva
      if (!db.objectStoreNames.contains("services")) {
        const sv = db.createObjectStore("services", { keyPath: "id" });
        sv.createIndex("by_machine", "machine");
        sv.createIndex("by_date", "date");
        sv.createIndex("by_type", "type");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putGeneric(storeName, obj) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, "readwrite");
    t.objectStore(storeName).put(obj);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

async function getAllGeneric(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, "readonly");
    const req = t.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getGeneric(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, "readonly");
    const req = t.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteGeneric(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, "readwrite");
    t.objectStore(storeName).delete(id);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

// ---- Entries ----
export async function putEntry(entry) { return putGeneric("entries", entry); }
export async function getAllEntries() { return getAllGeneric("entries"); }
export async function getEntry(id) { return getGeneric("entries", id); }
export async function deleteEntry(id) { return deleteGeneric("entries", id); }

// ---- Meta ----
export async function setMeta(key, value) { return putGeneric("meta", { key, value }); }
export async function getMeta(key) {
  const row = await getGeneric("meta", key);
  return row?.value;
}

// ---- Shifts ----
export async function putShift(shift) { return putGeneric("shifts", shift); }
export async function getAllShifts() { return getAllGeneric("shifts"); }

// ---- Visits ----
export async function putVisit(visit) { return putGeneric("visits", visit); }
export async function getAllVisits() { return getAllGeneric("visits"); }

// ---- Services ----
export async function putService(service) { return putGeneric("services", service); }
export async function getAllServices() { return getAllGeneric("services"); }
export async function deleteService(id) { return deleteGeneric("services", id); }

// ---- Wipe ----
export async function wipeAll() {
  const db = await openDB();

  const clearStore = (name) =>
    new Promise((resolve, reject) => {
      const t = db.transaction(name, "readwrite");
      t.objectStore(name).clear();
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });

  await clearStore("entries");
  await clearStore("meta");
  await clearStore("shifts");
  await clearStore("visits");
  await clearStore("services");
}
