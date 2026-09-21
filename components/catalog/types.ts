/**
 * Bentuk tampilan kecil yang dipakai bersama komponen katalog publik.
 *
 * Bukan lapisan abstraksi: ketiga komponen katalog memakai
 * `formatTimestamp`, dan menyalinnya tiga kali berarti tiga tempat yang
 * dapat menyimpang.
 */

/** Penanda waktu `m:ss`. Nol detik tetap ditampilkan sebagai "0:00". */
export function formatTimestamp(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Progres `0..1`, dijepit ke rentangnya. */
export function fractionOf(positionMs: number, totalMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return Math.min(Math.max(positionMs / totalMs, 0), 1);
}
