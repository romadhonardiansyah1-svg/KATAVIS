import type { Metadata, Viewport } from "next";

import { AccessibilityToggle } from "@/components/a11y/AccessibilityToggle";
import { ProfileProvider } from "@/components/a11y/ProfileProvider";

import "./globals.css";

/**
 * Kerangka akar.
 *
 * `lang="id"` bukan hiasan: pembaca layar memakainya untuk memilih aturan
 * pelafalan, dan seluruh isi antarmuka berbahasa Indonesia.
 */
export const metadata: Metadata = {
  title: "KATAVIS",
  description: "Katalog digital untuk pengrajin",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pembesaran tidak dibatasi: membatasinya melanggar WCAG 2.1 SC 1.4.4.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="id">
      <body>
        {/*
          Penyedianya di akar, bukan di dalam alur: profil yang dipilih di
          satu halaman harus berlaku di halaman berikutnya, dan tombolnya
          harus dapat dijangkau dari mana pun (S1-01).
        */}
        <ProfileProvider>
          {children}
          <AccessibilityToggle />
        </ProfileProvider>
      </body>
    </html>
  );
}
