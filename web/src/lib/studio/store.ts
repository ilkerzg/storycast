const DB = "storycast";
const STORE = "films";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export type FilmRecord = Record<string, any> & { id: string };

export const saveRecord = (rec: FilmRecord) => tx("readwrite", (s) => s.put(structuredClone(rec)));
export const loadRecord = (id: string) => tx<FilmRecord | undefined>("readonly", (s) => s.get(id));
export const allRecords = () => tx<FilmRecord[]>("readonly", (s) => s.getAll());
export const deleteRecord = (id: string) => tx("readwrite", (s) => s.delete(id));

export function cacheGet(bucket: string, key: string): string | undefined {
  try {
    return (JSON.parse(localStorage.getItem(`storycast-${bucket}`) || "{}") as Record<string, string>)[key];
  } catch {
    return undefined;
  }
}

export function cacheSet(bucket: string, key: string, value: string) {
  try {
    const all = JSON.parse(localStorage.getItem(`storycast-${bucket}`) || "{}");
    all[key] = value;
    localStorage.setItem(`storycast-${bucket}`, JSON.stringify(all));
  } catch {}
}
