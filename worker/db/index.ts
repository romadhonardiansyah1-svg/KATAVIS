/**
 * Ekspor publik lapisan akses data.
 *
 *   counter.ts  penghitung kueri per invocation dan handle `Db` yang sempit
 *   queries.ts  seluruh kueri baca, semuanya satu pernyataan atau satu batch
 *
 * Modul lain hanya boleh memanggil lewat berkas ini (ADR-001). Yang tidak
 * diekspor sama pentingnya dengan yang diekspor: `D1Database` mentah tidak
 * pernah keluar dari sini, sehingga tidak ada modul yang dapat menjalankan
 * kueri tanpa tercatat.
 */

export {
  QUERY_BUDGET,
  QueryBudgetExceeded,
  assertWithinBudget,
  createDb,
  createQueryCounter,
} from "./counter";

export type { Db, DbStatement, QueryCounter } from "./counter";

export { findPublicCatalogEntry, listProducts, loadProductDetail } from "./queries";

export type {
  ContentSource,
  JobSummary,
  MediaAsset,
  ProductContent,
  ProductDetail,
  ProductListItem,
  ProductListQuery,
  ProductPage,
  PublicCatalogEntry,
  TranscriptSummary,
} from "./queries";
