/**
 * Ekspor publik modul rbac.
 *
 * Modul lain hanya boleh memanggil lewat berkas ini (ADR-001). Aturan
 * izinnya sendiri ada di `permissions.ts` — sengaja dipisah dan murni agar
 * seluruh kasus ujinya berjalan tanpa D1.
 */

import { apiError } from "../../lib/errors";

export {
  canAcceptInvite,
  canCurate,
  canDeleteProduct,
  canEditDraft,
  canPublish,
  canSubmitReview,
  canUploadMedia,
  canViewProduct,
  inviteExpiresAt,
  isKnownRole,
  isSessionCurrent,
  parseCaregiverLink,
} from "./permissions";

export type {
  Actor,
  CaregiverLink,
  CaregiverLinkRow,
  CaregiverLinkStatus,
  ProductRef,
} from "./permissions";

/**
 * Respons tunggal untuk setiap penolakan izin (kontrak API bagian 12).
 *
 * Dipakai di batas rute — `if (!canPublish(user, product)) return forbidden();`
 * — sehingga tidak ada rute yang bisa lupa membentuk respons penolakan yang
 * benar, dan tidak ada yang mengarang kode galat baru.
 */
export function forbidden(): Response {
  return apiError("FORBIDDEN");
}

// Akses D1 tautan pendamping. Aturan izinnya tetap di `permissions.ts`.
export {
  d1AcceptInvite,
  d1CreateInvite,
  d1FindInviteByToken,
  d1FindLinkById,
  d1FindLinkFor,
  d1ListLinksForArtisan,
  d1RevokeLink,
} from "./d1-links";

export type { InviteInput } from "./d1-links";
