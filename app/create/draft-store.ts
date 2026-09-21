/**
 * Draf di perangkat (FEATURE-SPECS S5).
 *
 * IndexedDB, bukan localStorage: draf memuat potongan rekaman dan foto yang
 * dapat melewati batas beberapa kilobyte localStorage, dan penulisannya
 * asinkron sehingga tidak menahan utas utama saat pengrajin menekan tombol.
 *
 * Seluruh fungsi di sini aman dipanggil saat tidak ada `indexedDB` — yaitu
 * saat halaman dirender di server. Dalam keadaan itu pembacaannya
 * mengembalikan null dan penulisannya tidak melakukan apa pun, sehingga
 * pemanggil tidak perlu memeriksa lingkungannya sendiri.
 */

import { EMPTY_DRAFT, type Draft } from "./flow";

const DATABASE_NAME = "katavis";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const DRAFT_KEY = "current";

/**
 * Batas tunggu pembukaan basis data.
 *
 * `indexedDB.open` tidak diwajibkan memanggil satu pun dari `onsuccess`,
 * `onerror`, atau `onblocked` — dan pada sebagian peramban, dalam keadaan
 * tertentu, ia memang tidak memanggil apa pun. Janji yang menggantung
 * membuat halaman berhenti di "Memuat pekerjaan Anda..." selamanya, tanpa
 * satu pun galat yang terlihat: pengrajin tidak dapat melanjutkan, dan
 * tidak ada yang tahu mengapa.
 *
 * Batas ini mengubah keadaan itu menjadi keadaan yang jelas: draf tidak
 * dapat dipulihkan, alurnya tetap berjalan, dan pekerjaannya tidak hilang
 * karena penyimpanannya memang belum sempat terjadi.
 */
const OPEN_TIMEOUT_MS = 3_000;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: IDBDatabase | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };

    const timer = window.setTimeout(() => {
      settle(null);
    }, OPEN_TIMEOUT_MS);

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => settle(request.result);
    // Penyimpanan yang tidak dapat dibuka bukan alasan menghentikan alur:
    // pengrajin tetap dapat menyelesaikan katalognya, hanya tanpa pemulihan
    // draf bila tabnya tertutup.
    request.onerror = () => settle(null);
    // Pembukaan yang terblokir — versi basis data hendak dinaikkan sementara
    // koneksi lain masih terbuka — juga tidak memanggil onsuccess.
    request.onblocked = () => settle(null);
  });
}

function runTransaction<TValue>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<TValue>,
): Promise<TValue | null> {
  return openDatabase().then(
    (database) =>
      new Promise<TValue | null>((resolve) => {
        if (database === null) {
          resolve(null);
          return;
        }

        const transaction = database.transaction(STORE_NAME, mode);
        const request = work(transaction.objectStore(STORE_NAME));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      }),
  );
}

/**
 * Membaca draf.
 *
 * Bidang yang hilang diisi nilai bawaan, sehingga draf yang ditulis versi
 * sebelumnya tetap dapat dibuka setelah bentuknya berubah.
 */
export async function readDraft(): Promise<Draft | null> {
  const stored = await runTransaction<Draft | undefined>("readonly", (store) =>
    store.get(DRAFT_KEY) as IDBRequest<Draft | undefined>,
  );

  if (stored === null || stored === undefined) return null;
  return { ...EMPTY_DRAFT, ...stored };
}

export async function writeDraft(draft: Draft): Promise<void> {
  await runTransaction("readwrite", (store) => store.put(draft, DRAFT_KEY));
}

export async function clearDraft(): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(DRAFT_KEY));
}
