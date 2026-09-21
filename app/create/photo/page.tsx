"use client";

/**
 * Langkah 1 — "Arahkan kamera ke produk Anda".
 *
 * Aksi utama layar ini berpindah mengikuti keadaan, dan hanya ada satu pada
 * satu waktu: sebelum ada foto, aksinya memilih foto; sesudahnya, aksinya
 * melanjutkan. Dua tombol berbobot sama tidak pernah tampil bersamaan
 * (S2-02).
 *
 * Validasi di sini adalah kenyamanan, bukan keamanan: ukuran dan jenis
 * berkas diperiksa lebih dulu supaya pengrajin tidak menunggu unggahan yang
 * pasti ditolak. Pemeriksaan yang mengikat tetap di server (AGENTS.md
 * aturan 3).
 */

import { useRef, useState } from "react";

import { ERROR_CATALOG } from "@/lib/errors";
import { notify } from "@/lib/notify";

import { StepLoading, StepShell, type StepError } from "../StepShell";
import {
  confirmMedia,
  createProduct,
  requestUploadUrl,
  uploadToSignedUrl,
} from "../api";
import styles from "../flow.module.css";
import { CameraIcon, MicrophoneIcon } from "../icons";
import { readAccessToken } from "@/lib/session";
import { useCreateFlow } from "../useDraft";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

function messageOf(code: keyof typeof ERROR_CATALOG): StepError {
  const entry = ERROR_CATALOG[code];
  return { message: entry.message, action: entry.action };
}

function idempotencyKey(): string {
  // ULID 26 karakter, sesuai bentuk yang diminta kontrak API bagian 1.
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export default function PhotoPage(): React.JSX.Element {
  const { draft, savedAt, isSaving, update, goTo } = useCreateFlow("photo");
  const inputRef = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<StepError | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  if (draft === null) return <StepLoading />;

  const photoChosen = draft.photoMediaId !== null;

  /**
   * Menampilkan galat sekaligus menyampaikannya lewat tiga kanal S10
   * (ikon peringatan + pesan + langkah berikutnya, nada gagal, tiga getar
   * pendek). Dipusatkan di sini supaya tidak ada satu pun jalur galat yang
   * terlewat membunyikan kanal audionya.
   */
  function fail(next: StepError): void {
    setError(next);
    notify("error");
  }

  async function uploadPhoto(file: File): Promise<void> {
    const token = readAccessToken();
    if (token === null) {
      fail(messageOf("UNAUTHENTICATED"));
      return;
    }

    if (!ALLOWED_MIME.includes(file.type)) {
      fail(messageOf("UNSUPPORTED_FORMAT"));
      return;
    }

    if (file.size > MAX_BYTES) {
      fail(messageOf("FILE_TOO_LARGE"));
      return;
    }

    setError(null);
    setIsBusy(true);

    // Produk dibuat di sini, bukan di layar sebelumnya: langkah pertama
    // adalah hal pertama yang menghasilkan sesuatu untuk disimpan.
    let productId = draft?.productId ?? null;
    if (productId === null) {
      const created = await createProduct(token, idempotencyKey());
      if (!created.ok) {
        setIsBusy(false);
        fail({ message: created.error.message, action: created.error.action });
        return;
      }

      productId = created.data.id;
      update({ productId });
    }

    const ticket = await requestUploadUrl(token, productId, {
      kind: "photo_original",
      mimeType: file.type,
      bytes: file.size,
    });

    if (!ticket.ok) {
      setIsBusy(false);
      fail({ message: ticket.error.message, action: ticket.error.action });
      return;
    }

    const uploaded = await uploadToSignedUrl(ticket.data.uploadUrl, file);
    if (!uploaded.ok) {
      setIsBusy(false);
      fail({ message: uploaded.error.message, action: uploaded.error.action });
      return;
    }

    const confirmed = await confirmMedia(token, productId, ticket.data.mediaId);
    setIsBusy(false);

    if (!confirmed.ok) {
      fail({ message: confirmed.error.message, action: confirmed.error.action });
      return;
    }

    update({ photoMediaId: ticket.data.mediaId });
    setPreviewUrl(URL.createObjectURL(file));

    // Peristiwa "Foto tersimpan" (tabel S10): nada pendek + satu getar
    // singkat. Kanal visualnya adalah baris status di bawah ini.
    notify("photo-saved");
  }

  return (
    <StepShell
      step="photo"
      savedAt={savedAt}
      isSaving={isSaving}
      error={error}
      primary={
        photoChosen
          ? {
              label: "Lanjut rekam cerita",
              icon: <MicrophoneIcon />,
              onClick: () => goTo("record"),
            }
          : {
              label: "Ambil atau pilih foto",
              icon: <CameraIcon />,
              onClick: () => inputRef.current?.click(),
              busy: isBusy,
              busyLabel: "Mengunggah foto...",
            }
      }
    >
      <p className={styles.hint}>
        Letakkan produk di tempat terang dengan latar polos. Anda boleh memakai kamera
        langsung atau memilih foto yang sudah ada.
      </p>

      <div className={styles.photoFrame}>
        {previewUrl === null ? (
          <CameraIcon size={48} />
        ) : (
          <img className={styles.photoImage} src={previewUrl} alt="Pratinjau foto produk Anda" />
        )}
      </div>

      {photoChosen ? (
        <p className={styles.statusRow}>
          <span className={styles.statusIconSuccess}>
            <CameraIcon size={20} />
          </span>
          Foto produk tersimpan.
        </p>
      ) : null}

      <input
        ref={inputRef}
        className={styles.visuallyHidden}
        type="file"
        accept={ALLOWED_MIME.join(",")}
        capture="environment"
        aria-label="Pilih foto produk"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void uploadPhoto(file);
        }}
      />
    </StepShell>
  );
}
