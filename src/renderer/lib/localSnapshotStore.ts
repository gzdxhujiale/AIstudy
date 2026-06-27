export type LocalSnapshotKind = "mindmap" | "document" | "exam";

type LocalSnapshotRecord<T> = {
  key: string;
  kind: LocalSnapshotKind;
  value: T;
  updatedAt: string;
};

const DATABASE_NAME = "aistudy-local-snapshots";
const DATABASE_VERSION = 1;
const STORE_NAME = "snapshots";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前运行环境不支持 IndexedDB 本地快照存储"));
  }

  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("kind", "kind", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("打开本地快照数据库失败"));
      request.onblocked = () => reject(new Error("本地快照数据库被旧连接占用"));
    });
  }

  return databasePromise;
}

function runStoreRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = run(store);
        let result: T;

        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error ?? new Error("本地快照读写失败"));
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error ?? new Error("本地快照事务失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("本地快照事务中止"));
      })
  );
}

export async function readLocalSnapshot<T>(key: string): Promise<T | null> {
  const record = await runStoreRequest<LocalSnapshotRecord<T> | undefined>("readonly", (store) => store.get(key));
  return record?.value ?? null;
}

export async function writeLocalSnapshot<T>(key: string, kind: LocalSnapshotKind, value: T): Promise<void> {
  const record: LocalSnapshotRecord<T> = {
    key,
    kind,
    value,
    updatedAt: new Date().toISOString()
  };
  await runStoreRequest<IDBValidKey>("readwrite", (store) => store.put(record));
}

export async function deleteLocalSnapshot(key: string): Promise<void> {
  await runStoreRequest<undefined>("readwrite", (store) => store.delete(key));
}
