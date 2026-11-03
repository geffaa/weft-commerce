# Weft — breakdown

**Satu kalimat:** lapisan operasi e-commerce untuk klien global: toko headless (Medusa v2 + Next.js), hub integrasi NestJS yang menjaga stok dan order benar di Shopify dan mengirim order terbayar ke Xero, dan asisten RAG yang diukur dan tidak mengarang harga.

**Status:** breakdown + mockup selesai (2026-11-03). Belum ada kode. Keputusan stack: TypeScript, dari riset pasar (`portfolio-roadmap/reports/Backend stack demand comparison.md`), bukan dari kebiasaan Laravel.

## Fitur MVP
F1 inti toko dan wilayah (USD/GBP/EUR/AUD, Stripe uji) · F2 storefront · F3 koneksi Shopify dan impor · F4 buku besar order dan stok · F5 order ke Xero · F6 outbox, retry, exceptions · F7 rekonsiliasi · F8 konsol · F9 asisten RAG · F10 evaluasi · F11 peran, audit, rahasia.

## Asumsi paling berisiko
1. Klien global membayar untuk integrasi dan operasi (bukti permintaan tipis; tidak diverifikasi: pengecekan Upwork M0 dilewati atas keputusan user).
2. Xero tier gratis atau demo company cukup untuk uji tulis faktur (harga dan batas berubah; sumber tunggal).
3. Estimasi 3–4 minggu paruh waktu, bukan 2–3. Urutan pemotongan ada di MILESTONES.
4. NestJS dipilih karena kecocokan dan portfolio; belum ada bukti permintaan khusus NestJS.

## Desain
Sistem desain sendiri ("workshop ledger"): lihat `DESIGN.md` dan `mockups/index.html` (Exceptions, Reconciliation, Assistant review + Evals).

## Dokumen
- [PRODUCT.md](PRODUCT.md) · [DESIGN.md](DESIGN.md)
- [docs/PRD.md](docs/PRD.md) · [docs/TECH-SPEC.md](docs/TECH-SPEC.md) · [docs/MILESTONES.md](docs/MILESTONES.md)
- [docs/FEATURE-MAP.md](docs/FEATURE-MAP.md) · [docs/IA.md](docs/IA.md) · [docs/SCREENS.md](docs/SCREENS.md)
- [mockups/index.html](mockups/index.html)


## Catatan serah-terima (3 Nov 2026)
- Keputusan: toko merek sendiri (bukan marketplace); tema demo storefront = suku cadang motor dengan fitment (Halden Moto Parts), gaya "calm catalogue" (lembut, petrol, Albert Sans; gaya tajam oranye ditolak user). Alasan di DESIGN.md.
- Mockup ada: konsol (exceptions, reconciliation, assistant, components) dan storefront (collection, pdp, search, cart, checkout, order).
- Selesai (sesi lanjutan): data contoh konsol (Assistant, Exceptions, Reconciliation) sudah pindah ke Halden Moto (SKU HM-*, pertanyaan fitment); tabel `bike_model` dan `part_fitment` ada di TECH-SPEC; "My garage" ada di PRD F2 dan MILESTONES M1.
- Selesai: mockup keranjang (peringatan fitment), checkout (kartu uji + catatan 3DS), dan status pesanan: `mockups/storefront-cart.html`, `-checkout.html`, `-order.html`. Dicek lewat screenshot desktop; tampilan ponsel belum dicek.
- Belum: cek tampilan konsol dan mockup di lebar ponsel.
- Keputusan (3 Nov 2026): M0 (cek pasar Upwork) dihapus; langsung ke M1.
- M1 berjalan (3 Nov 2026): monorepo + compose + CI skeleton selesai; `apps/medusa` (Medusa 2.22.2) ter-seed 4 wilayah, pajak manual 8 negara, gudang Leeds, 8 opsi ongkir. Belum: Stripe, storefront Next.js (termasuk My garage), spike payment provider, Playwright, foto produk.
- Port host Weft: Postgres 54330, Redis 6390 (5432/5433/6379 dipakai layanan lain di mesin user). Harga Medusa v2 memakai satuan utama, bukan unit minor; konversi di batas hub.
- Selesai: modul `fitment` (bike_model, part_fitment) + `GET /store/bike-models` dan `GET /store/fitment` (fits / no_fit / unknown); `src/scripts/seed-weft.ts` (idempotent): 9 generasi motor, 64 baris fitment, 24 produk synthetic, harga 4 mata uang, stok, harga tax-inclusive. Diverifikasi lewat Store API: pads CB500F 2019 = fits, sprocket 2013–15 = no_fit, tuas rem tanpa data = unknown, £24.90 incl. VAT (£20.75 tanpa pajak).
- Seed dijalankan dengan `pnpm --filter @weft/medusa exec medusa exec ./src/scripts/seed-weft.ts` setelah `db:migrate`; server perlu di-restart setelah mengubah price preference (cache).
- Selesai: Stripe uji di Medusa (`pp_stripe_stripe` di 4 wilayah; kunci di `apps/medusa/.env`, gitignored). Diverifikasi end-to-end lewat Store API dengan kartu uji: Visa -> order #1 £29.85 (£24.90 + £4.95 ongkir, tax-inclusive); kartu 3DS (`requires_action`) -> order TIDAK dibuat ("not authorized"), sesuai PRD F1. Belum: webhook Stripe (`STRIPE_WEBHOOK_SECRET` kosong; pakai `stripe listen` saat dev), uji lewat UI.
- Kunci uji Stripe sempat ditempel di chat atas izin user (sandbox); rotasi bila akun dipakai untuk hal lain.
- Storefront `apps/storefront` (Next 16.4, port 8100, CSS diekstrak dari mockup): koleksi (urut best-fit, saringan fits/posisi/stok, sortir harga), PDP (kotak fitment 3 keadaan, tombol beli nonaktif saat stok 0), keranjang (banner peringatan fitment, qty), My garage (dialog kustom, cookie), pemilih wilayah (ganti mata uang), server actions untuk keranjang. Diverifikasi lewat HTTP + screenshot; cart contoh = £56.40 dengan 1 peringatan, sama dengan mockup.
- Env storefront: `apps/storefront/.env.local` (gitignored). Jalankan: Medusa `pnpm --filter @weft/medusa dev` (9000) dan storefront `pnpm --filter @weft/storefront dev` (8100).
- Selesai: checkout dua tahap (detail + pengiriman -> Stripe PaymentElement), `/checkout/return` untuk metode berbasis redirect, status pesanan `/order/[id]` (pesanan tamu diambil lewat ID; ID tak bisa ditebak tapi memuat email/alamat, cukup untuk demo). Playwright (`apps/storefront/e2e/purchase.spec.ts`, memakai Chrome sistem): 5 tes hijau, termasuk pembelian GBP lewat UI Stripe asli dan kartu ditolak (tanpa order).
- Syarat verifikasi M1 terpenuhi. Sisa M1: spike payment provider kustom Medusa (0,5 hari); 3DS lewat UI belum diuji (hanya lewat API); status pesanan dan checkout belum dicek visual; ponsel belum dicek; E2E belum masuk CI (butuh Medusa + seed + kunci Stripe uji sebagai secret).
- Langkah berikut: M2 (hub NestJS: koneksi Shopify, ledger order, stok idempoten); putuskan TypeORM vs Drizzle.
