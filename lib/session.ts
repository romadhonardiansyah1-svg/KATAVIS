/**
 * Sesi pengrajin di sisi klien.
 *
 * Hanya menyimpan token akses yang sudah diterbitkan layar masuk. Layar itu
 * belum ada, dan berkas ini sengaja tidak memuat logika masuk apa pun — ia
 * hanya membaca apa yang sudah ada.
 *
 * `localStorage`, bukan IndexedDB: tokennya pendek, dibaca pada setiap
 * pemanggilan API, dan pembacaan sinkron menghindari kedipan "belum masuk"
 * pada render pertama.
 *
 * Tinggal di `lib/` karena dua lapisan memakainya: alur enam langkah di
 * `app/create/` dan lapisan aksesibilitas di `components/a11y/`. Menyalin
 * nama kuncinya ke dua tempat berarti dua tempat yang dapat berbeda
 * pendapat tentang di mana tokennya disimpan.
 */

const ACCESS_TOKEN_KEY = "katavis.accessToken";

export function readAccessToken(): string | null {
  if (typeof window === "undefined") return null;

  const token = window.localStorage.getItem(ACCESS_TOKEN_KEY);
  return token === null || token.length === 0 ? null : token;
}

export function writeAccessToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}
