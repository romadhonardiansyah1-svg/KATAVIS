/**
 * Logika layar masuk yang murni.
 *
 * Dipisah dari `page.tsx` dengan alasan yang sama seperti `flow.ts` dipisah
 * dari keenam halaman langkah: bagian yang murni dapat diuji tanpa peramban,
 * dan uji yang butuh peramban adalah uji yang pertama dilewati saat waktu
 * menipis.
 *
 * Keduanya menentu, dan kesalahannya menyalahkan pengrajin: nomor yang
 * sebenarnya benar ditolak sebagai "belum lengkap", atau hitungan mundur
 * yang berbunyi "0 detik lagi" sementara tombolnya masih mati.
 */

/**
 * Nomor telepon Indonesia menjadi bentuk yang diterima server.
 *
 * Pengrajin menulis "0812...", "+62 812-...", atau "(0812) 3456.7890", dan
 * ketiganya harus menjadi `+62812...` sebelum dikirim. Server menolak bentuk
 * lain dengan `UNAUTHENTICATED`, dan pesan itu tidak menjelaskan apa yang
 * salah dengan nomornya.
 *
 * Yang dikembalikan `null` bukan hanya bentuk yang salah, tetapi juga nomor
 * yang jelas bukan ponsel — telepon rumah Jakarta tidak dapat menerima SMS,
 * dan mengirimnya hanya menghabiskan jatah tiga permintaan per jam.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  if (digits.length === 0) return null;

  if (digits.startsWith("+62")) {
    const rest = digits.slice(3);
    return /^8\d{7,12}$/.test(rest) ? `+62${rest}` : null;
  }
  if (digits.startsWith("62")) {
    const rest = digits.slice(2);
    return /^8\d{7,12}$/.test(rest) ? `+62${rest}` : null;
  }
  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    return /^8\d{7,12}$/.test(rest) ? `+62${rest}` : null;
  }
  if (digits.startsWith("8")) {
    return /^8\d{7,12}$/.test(digits) ? `+62${digits}` : null;
  }

  return null;
}

/**
 * Hitungan mundur ke bentuk "3 menit lagi" atau "45 detik lagi".
 *
 * Dibulatkan ke atas, tidak ke bawah. Menampilkan "0 detik lagi" sementara
 * tombol kirim ulang masih mati membuat pengrajin mengira tombolnya rusak —
 * dan itu keluhan yang tidak dapat dijawab oleh layar mana pun.
 */
export function formatWait(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (seconds < 60) return `${seconds} detik lagi`;

  return `${Math.ceil(seconds / 60)} menit lagi`;
}
