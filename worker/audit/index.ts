/**
 * Ekspor publik modul audit.
 *
 * Modul lain hanya boleh memanggil lewat berkas ini (ADR-001). Isinya satu
 * fungsi tulis dan satu fungsi murni:
 *
 *   logActivity       mencatat satu aktivitas ke `activity_log`
 *   resolveOnBehalfOf menerjemahkan peran aktor menjadi isi `on_behalf_of`
 *
 * Tidak ada fungsi baca. Log aktivitas dibaca lewat kueri langsung oleh
 * siapa pun yang membutuhkannya — sampai sekarang hanya pengujian — dan
 * menambahkan lapisan baca di sini berarti modul yang seharusnya hanya
 * menulis ikut menentukan bentuk penyajiannya.
 */

export { logActivity, resolveOnBehalfOf } from "./logger";

export type {
  ActivityEntry,
  AttributionResult,
  AuditActor,
  AuditEntity,
  AuditRejection,
  AuditResult,
} from "./logger";
