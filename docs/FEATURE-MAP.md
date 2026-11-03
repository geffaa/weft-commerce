# Feature map — Weft

Peta semua fitur sampai fase akhir. MVP = fase 1, P2 = fase 2, P3 = fase 3. Sumber riset: laporan `portfolio-roadmap/reports/Custom ecommerce positioning.md` dan `Backend stack demand comparison.md` (2026-11-03). Banyak sumber di laporan itu pihak ketiga: angka harga ditandai **verifikasi**.

## 1. Pesaing dan pembanding yang dipakai

| Kelompok | Contoh | Pelajaran untuk Weft | Sumber / catatan |
|---|---|---|---|
| Platform siap pakai | Shopify, BigCommerce, WooCommerce | Menang di kecepatan; kalah di logika khusus, checkout di luar Plus, biaya transaksi gateway pihak ketiga (Shopify: 2% / 1% / 0,6% / 0,2% per paket) | shopify.com/pricing (diambil 2026-11-03); share: W3Techs, StoreLeads (angka berbeda antar sumber) |
| Engine headless | Medusa v2, Saleor, Vendure | Fondasi yang dipakai klien global: MIT (Medusa), BSD (Saleor), GPLv3/komersial (Vendure). Medusa Cloud $29/$99/$299 per bulan, 0% GMV | GitHub dan halaman harga resmi, 2026-11-03 |
| Sinkron multikanal | Linnworks, Brightpearl, Cin7, Sellbrite | Pola: buku besar stok terpusat, webhook + rekonsiliasi terjadwal, konsumen idempoten. Cin7 sekitar $349–799/bln, Sellbrite dari sekitar $49/bln | situs agregator, **verifikasi** |
| AI dukungan | Intercom Fin, Gorgias, Tidio Lyro | Dibeli per hasil: sekitar $0,70–1,00 per percakapan terselesaikan | situs agregator, harga bertentangan antar sumber, **verifikasi** |
| Akuntansi | Xero, QuickBooks | Order → faktur adalah integrasi yang paling dicari. Xero tier baru sejak 2 Mar 2026; app tak tersertifikasi maksimum 25 organisasi | sumber tunggal, **verifikasi** |

Celah yang dituju Weft: klien yang tidak ingin "toko lain", tetapi ingin **satu buku besar order dan stok yang benar** di atas toko dan kanal yang sudah ada, ditambah asisten pelanggan yang tidak mengarang.

## 2. Peta fitur

Tanda: ✔ MVP · P2 · P3.

### A. Inti toko (Medusa v2)
| Fitur | Fase |
|---|---|
| Produk, varian, opsi, koleksi, kategori, gambar | ✔ |
| Regions dan multi-currency (USD, GBP, EUR, AUD) dengan harga per wilayah | ✔ |
| Keranjang, checkout, pesanan, pelanggan | ✔ |
| Pembayaran Stripe (mode uji) dengan 3-D Secure | ✔ |
| Ongkir tarif tetap per wilayah | ✔ |
| Pajak: tarif manual per wilayah, tampil inklusif/eksklusif | ✔ |
| Stripe Tax atau tax engine lain | P2 |
| Retur / RMA dan refund | P2 |
| Price list B2B, akun perusahaan | P3 |
| Multi-vendor / marketplace | P3 |

### B. Storefront (Next.js, Inggris)
| Fitur | Fase |
|---|---|
| Beranda, koleksi dengan filter dan sortir, PDP, keranjang, checkout, halaman status pesanan | ✔ |
| Pemilih wilayah dan mata uang | ✔ |
| Widget asisten (chat) | ✔ |
| Multi-bahasa (i18n, hreflang) | P2 |
| Pencarian semantik (pgvector) di toko | P2 |
| Rekomendasi produk | P3 |

### C. Hub integrasi (NestJS)
| Fitur | Fase |
|---|---|
| Koneksi Shopify (custom app, Admin GraphQL): impor produk dan stok, webhook produk/stok/order | ✔ |
| Buku besar order terpadu (storefront Weft + Shopify) | ✔ |
| Dorong stok Weft ke Shopify (set kuantitas idempoten) | ✔ |
| Dorong order terbayar ke Xero (faktur + pembayaran) | ✔ |
| Outbox, retry backoff, dead-letter, deduplikasi webhook | ✔ |
| Rekonsiliasi terjadwal (stok vs Shopify, order vs Xero) dengan laporan selisih | ✔ |
| Pemetaan SKU (Weft ↔ Shopify varian) dengan deteksi konflik | ✔ |
| Konsol operasi (koneksi, runs, exceptions, rekonsiliasi) | ✔ |
| Kanal WooCommerce (REST) | P2 |
| QuickBooks Online | P2 |
| Webhook keluar dan resep n8n/Make | P2 |
| Pengiriman: Shippo/EasyPost | P2 |
| Amazon SP-API, Etsy, TikTok Shop/Tokopedia, Shopee | P3 (butuh persetujuan/akun penjual) |

### D. Asisten AI (RAG)
| Fitur | Fase |
|---|---|
| Tanya-jawab produk dan kebijakan dari katalog dan dokumen (pgvector) | ✔ |
| Cek status pesanan lewat nomor + email (alat langsung, bukan dari ingatan model) | ✔ |
| Pengungkapan bahwa pengguna berbicara dengan AI, serah-terima ke manusia | ✔ |
| Guardrail: harga, stok, dan janji hanya dari hasil alat; menolak di luar cakupan | ✔ |
| Set evaluasi 50–100 pertanyaan dengan papan skor | ✔ |
| Konsol tinjau percakapan (sumber, panggilan alat, tandai salah) | ✔ |
| Penulisan deskripsi/atribut produk dengan AI (diperkaya, disetujui manusia) | P2 |
| Deteksi risiko retur/fraud | P3 |

### E. Platform
| Fitur | Fase |
|---|---|
| Satu tenant per deploy, peran (Owner, Ops, Finance, Support) | ✔ |
| Audit log tindakan sensitif | ✔ |
| Rahasia koneksi terenkripsi, tanda tangan webhook diverifikasi | ✔ |
| Multi-tenant (banyak toko dalam satu deploy) | P3 |
