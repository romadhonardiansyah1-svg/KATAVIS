/**
 * Sesi pengrajin di sisi klien.
 *
 * Menyimpan dua token yang diterbitkan layar masuk, dan tidak memuat logika
 * masuk apa pun — pengambilan tokennya ada di `app/masuk/`, sedangkan berkas
 * ini hanya membaca dan menulis apa yang sudah ada. Pemisahan itu disengaja:
 * dua tempat yang tahu cara menyimpan token adalah dua tempat yang dapat
 * berbeda pendapat tentang di mana tokennya berada.
 *
 * `localStorage`, bukan IndexedDB: tokennya pendek, dibaca pada setiap
 * pemanggilan API, dan pembacaan sinkron menghindari kedipan "belum masuk"
 * pada render pertama.
 *
 * Tinggal di `lib/` karena tiga lapisan memakainya: layar masuk, alur enam
 * langkah di `app/create/`, dan lapisan aksesibilitas di `components/a11y/`.
 * Menyalin nama kuncinya ke tiga tempat berarti tiga tempat yang dapat
 * berbeda pendapat.
 */

const ACCESS_TOKEN_KEY = "katavis.accessToken";
const REFRESH_TOKEN_KEY = "katavis.refreshToken";

export function readAccessToken(): string | null {
  if (typeof window === "undefined") return null;

  const token = window.localStorage.getItem(ACCESS_TOKEN_KEY);
  return token === null || token.length === 0 ? null : token;
}

export function writeAccessToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function readRefreshToken(): string | null {
  if (typeof window === "undefined") return null;

  const token = window.localStorage.getItem(REFRESH_TOKEN_KEY);
  return token === null || token.length === 0 ? null : token;
}

export function writeRefreshToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

/**
 * Menghapus sesi.
 *
 * Kedua token dihapus bersama. Menyisakan refresh token setelah pengrajin
 * keluar berarti perangkat itu masih dapat memperoleh akses baru — dan pada
 * perangkat yang dipakai bergantian di SLB, itu bukan detail.
 */
export function clearAccessToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}
