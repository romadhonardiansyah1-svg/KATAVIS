# Architecture Decision Records

Setiap keputusan yang menyimpang dari `PROPOSAL DIGIBOOM_KATAVIS_APHACKATON 2026.pdf` dicatat di
sini beserta alasannya. Juri berhak bertanya mengapa implementasi berbeda dari proposal, dan
jawabannya harus tersedia dalam bentuk tertulis, bukan ingatan.

| ADR | Judul | Status | Menyimpang dari proposal? |
|---|---|---|---|
| [001](ADR-001-modular-monolith.md) | Modular monolith, bukan microservices | Diterima | Ya |
| [002](ADR-002-android-twa.md) | Android lewat TWA, bukan Kotlin native | Diterima | Tidak (proposal menyebut PWA) |
| [003](ADR-003-asr-provider.md) | Groq Whisper turbo, bukan Whisper Large-v3 lokal | Diterima | Ya |
| [004](ADR-004-image-provider.md) | Gemini web + fallback Workers AI, bukan SAM + Stable Diffusion | Diterima | Ya |
| [005](ADR-005-avatar-engine.md) | Avatar 2D + TTS, bukan SadTalker/LivePortrait | Diterima | Ya |
| [006](ADR-006-data-store.md) | D1 + R2, bukan PostgreSQL + Prisma | Diterima | Ya |
| [007](ADR-007-latency-claim.md) | Definisi ulang klaim latensi 300ms | Diterima | Ya — koreksi klaim |
| [008](ADR-008-transcript-review.md) | Tinjau transkrip wajib sebelum LLM | Diterima | Tidak — tambahan |

## Format

Setiap ADR memuat: konteks, keputusan, alasan, konsekuensi, dan alternatif yang ditolak beserta
sebabnya. Alternatif yang ditolak sama pentingnya dengan yang dipilih — ia menunjukkan keputusan
dibuat sadar, bukan kebetulan.
