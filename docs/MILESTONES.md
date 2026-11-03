# Milestones — Weft

Estimasi jujur untuk satu orang paruh waktu: **±21 hari kerja (3–4 minggu)**, lebih panjang dari harapan 2–3 minggu. Jika molor, potong dalam urutan: (1) evaluasi lanjutan di M4, (2) Xero di M3 (pindah ke P2), (3) rekonsiliasi Xero. Setiap milestone menghasilkan sesuatu yang bisa dicoba.

## M1 — Monorepo, Medusa, storefront (±4 hari)
- [x] Monorepo pnpm, `docker-compose` (Postgres+pgvector, Redis), CI lint+tes
- [x] Medusa v2 dengan wilayah US/UK/EU/AU, harga per wilayah, pajak manual, ongkir tarif tetap
- [x] Stripe uji (kartu biasa dan 3DS): diverifikasi lewat Store API; belum lewat UI storefront
- [x] Storefront Next.js: koleksi (sortir harga benar), PDP, keranjang, checkout (Stripe.js), status pesanan, pemilih wilayah
- [ ] Spike 0,5 hari: payment provider kustom Medusa (catat temuan)
- [x] Seed 24 suku cadang fiktif Halden Moto Parts berlabel synthetic, beserta data fitment (±8 model motor)
- [x] My garage: dialog kustom + cookie, penanda fitment di koleksi/PDP/keranjang, saringan "Only parts that fit" (akun dan pencarian ditunda)
- **Fitur PRD:** F1, F2
- **Verifikasi:** pembelian Stripe uji dalam GBP selesai; suku cadang yang tidak cocok dengan motor di garage memunculkan peringatan; tes E2E Playwright hijau. **Terpenuhi 3 Nov 2026** (5 tes, `pnpm --filter @weft/storefront e2e`); sisa: spike provider kustom dan tes UI untuk 3DS.

## M2 — Hub dan Shopify (±5 hari)
- [x] NestJS hub: modul `connections`, `sync`, `outbox`, `webhooks`; skema `hub`; guard peran
- [x] Koneksi Shopify (token, uji, scope); impor produk/varian/stok
- [x] Webhook Shopify (HMAC, receipt idempoten); pemetaan SKU dan deteksi konflik (pendaftaran webhook via `POST /connections/:id/webhooks` sudah ada, diuji dengan tiruan; belum dicoba ke Shopify karena butuh URL https publik)
- [x] Ledger order terpadu (storefront + Shopify); buku besar stok; dorong stok absolut ke Shopify
- [x] Cek halaman resmi Shopify: laju API dan nama mutasi stok; jadikan konfigurasi (mutasi dan versi dicek; laju API belum diukur)
- **Fitur PRD:** F3, F4, F6 (dasar), F11 (HMAC, peran)
- **Verifikasi:** webhook order dikirim 3 kali → stok turun sekali; tes konkurensi 50 order/stok 10 → 10 sukses. **Terpenuhi 3 Nov 2026** (11 tes hub; tanpa `FOR UPDATE` tes konkurensi gagal dengan 26 sukses, jadi tesnya terbukti menguji kunci).

## M3 — Xero, exceptions, rekonsiliasi, konsol (±5 hari)
- [x] Koneksi Xero (Custom Connection `client_credentials`, Demo Company); faktur + pembayaran idempoten
- [x] Worker outbox: backoff, dead-letter, klasifikasi error (dikerjakan di M2)
- [ ] Rekonsiliasi malam (stok dan Xero) dengan laporan selisih dan "fix" (selesai: stok Shopify, jadwal malam; sisa: sisi Xero = order terbayar tanpa faktur)
- [ ] Konsol Next.js: Overview, Connections, Runs, Exceptions, Reconciliation, Products, Orders
- [ ] Peran dan audit log di konsol (backend selesai di M2; sisa: UI)
- **Fitur PRD:** F5, F6, F7, F8, F11
- **Verifikasi:** replay 10.000 event → 0 faktur ganda; matikan worker di tengah → lanjut sekali; kegagalan Xero yang disengaja muncul di Exceptions dan sembuh setelah retry. **Terpenuhi 3 Nov 2026:** replay 10.000 event (2.000 order x 5) dan worker mati di tengah terbukti dengan tiruan; kegagalan Xero muncul di Exceptions dan sembuh setelah retry terbukti di Demo Company nyata (GBP ditolak -> aktifkan GBP -> retry -> INV-0038 PAID).

## M4 — Asisten RAG dan evaluasi (±4 hari)
- [ ] Ingest dokumen kebijakan dan katalog ke pgvector; embedding dan chunking
- [ ] Alat `lookup_order` dan `get_price_stock`; pencocokan angka-ke-alat; pengungkapan AI; serah-terima
- [ ] Widget di storefront; rate limit
- [ ] 60 kasus evaluasi dan penilai; halaman Evals dan Conversations
- **Fitur PRD:** F9, F10
- **Verifikasi:** skor ≥ 85% dan 0 jawaban harga/stok tanpa alat; serangan injeksi pada dokumen tidak mengubah perilaku alat.

## M5 — Poles, bukti, rilis (±3 hari)
- [ ] Audit screenshot semua layar di 1440 dan 390 px; perbaikan
- [ ] README Inggris, video demo 60 detik, laporan evaluasi, studi kasus
- [ ] Deploy demo sandbox (atau alasan ditunda), repo bersih
- **Verifikasi:** semua tes hijau dari checkout bersih; tangkapan layar tanpa error konsol.

## Fase berikutnya (tidak dikerjakan sekarang)
P2: WooCommerce, QuickBooks, retur/RMA, Stripe Tax, multi-bahasa, pencarian semantik, deskripsi AI, webhook keluar/n8n. P3: Amazon/Etsy/TikTok/Tokopedia/Shopee, B2B, marketplace, multi-tenant.

## Definisi selesai (product)
Repo bersih + README + demo (atau alasan deploy ditunda) + tangkapan layar + catatan studi kasus singkat + laporan evaluasi.
