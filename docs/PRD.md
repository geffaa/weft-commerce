# PRD — Weft

Status: draft · Tanggal: 2026-11-03 · Sumber: keputusan stack dari riset `portfolio-roadmap/reports/` (Custom ecommerce positioning, Backend stack demand comparison), ide user (project #7, bukan Laravel).

## 1. Ringkasan
Weft adalah lapisan operasi e-commerce untuk merek yang menjual di lebih dari satu tempat. Intinya toko headless (Medusa v2 + storefront Next.js) ditambah **hub integrasi NestJS** yang menjaga stok dan order tetap benar di Shopify dan toko sendiri, mendorong order terbayar ke Xero, dan sebuah **asisten AI** yang menjawab pertanyaan pembeli dari katalog dan kebijakan tanpa mengarang. Ditujukan untuk klien global (AS, Inggris, Eropa, Australia). Ini produk portfolio Upwork #7 dan sengaja bukan Laravel.

## 2. Masalah
- Merek kecil dan menengah yang memakai Shopify atau Woo sering punya "pekerjaan salin": stok dihitung ulang di spreadsheet, order diketik ke Xero, pembeli bertanya hal yang sudah tertulis di kebijakan.
- Platform tidak menyelesaikannya sendiri: Shopify membatasi checkout di luar Plus (checkout.liquid dihentikan bertahap 2024–Agustus 2025) dan menarik biaya transaksi gateway pihak ketiga; sinkron multikanal dijual sebagai produk lain (Linnworks, Cin7, Sellbrite) seharga ratusan dolar per bulan (harga **verifikasi**).
- Asisten AI yang ada dibeli per percakapan terselesaikan (sekitar $0,70–1,00, **verifikasi**) dan terkenal bisa salah menyebut kebijakan; Moffatt v Air Canada menunjukkan perusahaan bertanggung jawab atas jawaban chatbotnya.
- Kompetitor Weft bukan "toko lain" tetapi gabungan langganan SaaS plus pekerjaan manual. Posisi: **satu buku besar yang benar, dipasang oleh developer, bukan langganan**.

## 3. Tujuan & metrik sukses
**Tujuan produk**
1. Stok dan order sama di semua kanal yang dihubungkan, dengan bukti (laporan rekonsiliasi nol selisih pada data demo).
2. Setiap order terbayar punya satu faktur Xero, tidak ganda walau webhook dikirim berulang.
3. Asisten menjawab dengan sumber, dan tidak pernah menyebut harga, stok, atau janji yang tidak berasal dari alat.
4. Seluruh sistem bisa didemokan **tanpa akun berbayar**.

**Metrik (portfolio)**
- Bukti teknis: skor evaluasi asisten ≥ 85% pada 60 pertanyaan dengan 0 jawaban harga/stok yang dikarang; 10.000 event webhook diputar ulang → 0 faktur ganda; tes konkurensi stok lulus.
- Sinyal pasar: balasan proposal dan undangan yang menyebut headless commerce, Shopify sync, Xero, atau RAG.

**Non-goal:** menyaingi Shopify sebagai platform toko; hosting multi-tenant; pembayaran selain Stripe; aplikasi mobile.

## 4. Persona & konteks
| Peran | Situasi | Pekerjaan | Frustrasi |
|---|---|---|---|
| **Operator** | Desktop, memeriksa pagi dan sore | Memastikan stok dan order cocok antar kanal | Oversell setelah promo di satu kanal; angka beda di tiap sistem |
| **Finance** | Desktop, akhir hari/bulan | Setiap order terbayar menjadi faktur | Mengetik ulang order; selisih tidak dijelaskan |
| **Support** | Desktop, seharian | Menangani yang tidak bisa dijawab AI | Pertanyaan berulang; tidak tahu AI menjawab apa |
| **Pembeli** | Ponsel, dari iklan | Memilih, membayar dalam mata uangnya, bertanya cepat | Harga dalam mata uang asing, jawaban tidak konsisten |
| **Developer klien** | Terminal | Memasang dan memperluas | Kotak hitam, tanpa log, tanpa tes |

## 5. Asumsi
| # | Asumsi | Risiko jika salah |
|---|---|---|
| A1 | Klien global mau membayar untuk integrasi dan operasi di atas Shopify/engine yang ada, bukan untuk toko dari nol | **Tinggi** (riset: bukti permintaan tipis; Upwork diblokir saat riset) |
| A2 | Medusa v2 menangani multi-currency, wilayah, dan Stripe cukup baik untuk MVP | Sedang |
| A3 | Toko dev Shopify gratis (gateway Bogus) cukup untuk mendemokan sinkron | Rendah |
| A4 | Xero tier gratis atau demo company memungkinkan uji tulis faktur | **Tinggi** (harga dan batas Xero berubah; sumber tunggal) |
| A5 | LLM murah (kelas Groq/Haiku, sekitar $0,002–0,003 per percakapan enam giliran) cukup akurat untuk RAG toko | Sedang |
| A6 | Satu orang dapat menyelesaikan MVP ini dalam 3–4 minggu paruh waktu (bukan 2–3) | **Tinggi** |
| A7 | NestJS dipilih untuk hub karena kecocokan (modul, DI, antrean) dan mengisi portfolio; permintaan khusus NestJS belum terbukti | Sedang |

## 6. Scope
**MVP:** F1–F11 di bawah. **Nanti:** WooCommerce, QuickBooks, retur/RMA, Stripe Tax, multi-bahasa, pencarian semantik, deskripsi produk AI, webhook keluar/n8n (P2); Amazon/Etsy/TikTok/Tokopedia/Shopee, B2B, marketplace, multi-tenant (P3). **Bukan tujuan:** pembayaran lokal Indonesia, POS, aplikasi mobile native.

## 7. User stories
- F3: Sebagai Operator saya ingin menghubungkan toko Shopify dan melihat produknya dipetakan ke SKU Weft, supaya stok punya satu sumber.
- F4: Sebagai Operator saya ingin stok berkurang di semua kanal ketika satu kanal menjual, supaya tidak oversell.
- F5: Sebagai Finance saya ingin setiap order terbayar menjadi satu faktur Xero, supaya tidak mengetik ulang.
- F6/F7: Sebagai Operator saya ingin melihat dan mengulang pekerjaan yang gagal dan laporan selisih tiap malam, supaya masalah tidak tersembunyi.
- F9: Sebagai Pembeli saya ingin bertanya "apakah ini bisa dikembalikan?" dan mendapat jawaban dengan sumber, supaya saya tidak menunggu email.
- F10: Sebagai Owner saya ingin tahu seberapa sering asisten benar, supaya saya berani menyalakannya.

## 8. Fitur MVP secara detail

### F1 Inti toko dan wilayah
Medusa v2 dengan wilayah US (USD), UK (GBP), EU (EUR), AU (AUD); harga per wilayah; pajak manual per wilayah; ongkir tarif tetap; Stripe test.
- Ketika pembeli memilih wilayah UK, maka semua harga, ongkir, dan pajak tampil dalam GBP dan keranjang menyimpan wilayahnya.
- Ketika pembayaran Stripe butuh 3-D Secure (kartu uji 3DS), maka alur menunggu otentikasi dan pesanan baru dibuat setelah pembayaran terkonfirmasi.
- Layar: S12–S16.

### F2 Storefront
Next.js, Inggris, tema demo Halden Moto Parts (suku cadang motor): beranda, koleksi (filter, sortir harga yang benar), PDP, keranjang, checkout, status pesanan, pemilih wilayah, widget asisten, dan "My garage" (pembeli menyimpan motornya: tahun, merek, model).
- Ketika pembeli mengurutkan "Price: low to high", maka urutan memakai harga di wilayahnya (bukan urutan ID).
- Ketika stok varian 0, maka tombol beli nonaktif dan menjelaskan alasannya.
- Ketika pembeli menyimpan motor di My garage, maka PDP dan hasil pencarian menandai tiap suku cadang "Fits your <motor>", "Does not fit", atau "Check fitment" (data fitment tidak ada), dan koleksi bisa disaring "Fits my bike".
- Ketika suku cadang tidak cocok dengan motor di garage dan pembeli menambahkannya ke keranjang, maka muncul peringatan fitment sebelum checkout (tidak memblokir).
- Layar: S12–S16.

### F3 Koneksi Shopify dan impor
Custom app Shopify (token Admin API), impor produk/varian/stok awal, pendaftaran webhook (produk, stok, order).
- Ketika Operator menyimpan token yang salah, maka uji koneksi gagal dengan pesan yang menyebut scope yang kurang, dan token tidak tersimpan.
- Ketika impor selesai, maka Products menampilkan jumlah varian terpetakan, tak terpetakan, dan konflik (SKU kembar atau kosong).
- Layar: S02, S06.

### F4 Buku besar order dan stok
Order dari storefront dan Shopify masuk ke ledger terpadu; stok Weft menjadi sumber kebenaran dan didorong ke Shopify dengan kuantitas absolut idempoten.
- Ketika order Shopify masuk, maka stok varian itu di Weft berkurang sekali (walau webhook dikirim 3 kali) dan stok baru didorong ke kanal lain.
- Ketika dua order untuk stok terakhir datang bersamaan dari dua kanal, maka tepat satu berhasil dan yang lain ditandai exception "insufficient stock".
- Layar: S07.

### F5 Dorong order ke Xero
Order terbayar → faktur + pembayaran di Xero dengan kunci idempotensi per order.
- Ketika event `order.paid` yang sama diterima dua kali, maka hanya satu faktur dibuat.
- Ketika Xero menolak (akun kode salah, kontak tak valid), maka order masuk Exceptions dengan penyebab terbaca dan tombol "retry setelah diperbaiki".
- Layar: S02, S04, S07.

### F6 Keandalan: outbox, retry, dead-letter
Semua tindakan keluar lewat outbox transaksional; retry backoff eksponensial dengan batas; setelah batas, dead-letter di Exceptions.
- Ketika proses hub dimatikan di tengah pekerjaan, maka pekerjaan dilanjutkan sekali setelah restart (tidak hilang, tidak ganda).
- Layar: S03, S04.

### F7 Rekonsiliasi
Pekerjaan malam membandingkan stok per kanal dengan buku besar dan order terbayar dengan faktur Xero.
- Ketika stok Shopify diubah manual, maka laporan menunjukkan selisih per varian dengan nilai kedua sisi dan tombol "set ulang dari Weft" yang membuat run baru.
- Layar: S05.

### F8 Konsol
Overview, Connections, Runs, Exceptions, Reconciliation, Products (pemetaan), Orders; lingkungan Sandbox/Live selalu terlihat.
- Ketika Operator membuka Overview, maka tiap jalur (Shopify, Xero, Assistant) menampilkan status, run terakhir, dan jumlah exception terbuka.
- Layar: S01–S07.

### F9 Asisten RAG
Jawaban dari katalog dan dokumen kebijakan (pgvector), alat `lookup_order(number, email)`, `get_price_stock(sku)`, serah-terima ke manusia.
- Ketika pembeli bertanya kebijakan retur, maka jawaban mengutip dokumen sumbernya.
- Ketika pembeli menanyakan harga atau stok, maka angka berasal dari alat, bukan dari teks yang dihasilkan model.
- Ketika pertanyaan di luar cakupan atau pembeli meminta manusia, maka percakapan dialihkan dengan ringkasan, dan pembeli diberi tahu.
- Setiap percakapan dibuka dengan pengungkapan bahwa pembeli berbicara dengan AI.
- Layar: S08, S09, S16.

### F10 Evaluasi
Set 60 pertanyaan berlabel (jawaban benar, kebutuhan alat, harus-menolak) dijalankan terhadap asisten; papan skor per kategori.
- Ketika evaluasi dijalankan, maka halaman menampilkan lulus/gagal per pertanyaan, skor per kategori, dan khusus jumlah jawaban yang menyebut harga/stok tanpa alat (harus 0).
- Layar: S10.

### F11 Peran, audit, rahasia
Peran Owner/Ops/Finance/Support; audit log tindakan sensitif; rahasia koneksi terenkripsi; tanda tangan webhook diverifikasi.
- Ketika peran Support membuka Connections, maka akses ditolak.
- Ketika webhook Shopify datang dengan HMAC salah, maka ditolak 401 dan tidak diproses.
- Layar: S11.

## 9. User flow
1. Owner menyiapkan toko dan wilayah di Medusa Admin; membuka Konsol (S01).
2. Operator menghubungkan Shopify (S02) → impor → menyelesaikan konflik pemetaan (S06).
3. Pembeli memilih wilayah (S12), memilih produk (S13/S14), membayar (S15), melihat status (S16 area pesanan).
4. Order tampil di ledger (S07); stok didorong; faktur Xero dibuat; kegagalan muncul di Exceptions (S04), dilihat di Runs (S03).
5. Malam: rekonsiliasi (S05).
6. Pembeli bertanya lewat widget (S16); Support meninjau (S08); Owner memperbarui dokumen (S09) dan menjalankan evaluasi (S10).

## 10. Kebutuhan non-fungsional
- **Keamanan:** rahasia dienkripsi saat disimpan (AES-GCM, kunci dari lingkungan); HMAC webhook diverifikasi; rate limit endpoint publik asisten; prompt injection: teks pelanggan dan dokumen diperlakukan sebagai data, alat tidak menerima perintah dari teks.
- **Privasi:** minimisasi data pada log; nomor kartu tidak pernah disentuh (Stripe Elements/redirect, cakupan PCI SAQ A — **verifikasi** dengan profesional); data pembeli dapat dihapus (GDPR/UK GDPR; **verifikasi hukum**).
- **Performa:** halaman storefront LCP < 2,5 dtk di data demo; jawaban asisten dimulai < 3 dtk.
- **Aksesibilitas:** WCAG 2.2 AA pada storefront dan konsol (European Accessibility Act berlaku sejak 28 Jun 2025 untuk toko online di EU; cakupan tepatnya **verifikasi**).
- **Lokalisasi:** mata uang per wilayah; unit minor; format tanggal/angka mengikuti wilayah. Multi-bahasa P2.
- **Keandalan:** idempotensi di semua konsumen webhook; outbox; backup basis data harian di deploy nyata.
- **Pengungkapan AI:** kewajiban transparansi chatbot EU AI Act Pasal 50 disebut berlaku 2 Agt 2026 oleh satu sumber (ada sumber yang menyebut 2028) — **verifikasi**; Weft mengungkapkan sejak awal.

## 11. Risiko & pertanyaan terbuka
| Risiko | Cara menguji termurah |
|---|---|
| Permintaan pasar untuk "integrasi + operasi" tipis (A1) | Pencarian Upwork 1 jam (16 kata kunci, daftar di laporan riset) sebelum M2 |
| Estimasi 2–3 minggu terlalu optimis (A6) | Potongan: M4–M5 bisa dikurangi; Xero dan evaluasi bisa ditunda jika M3 molor lebih dari 3 hari |
| Batas API dan harga Shopify/Xero berbeda dari catatan | Cek halaman resmi di awal M2; angka laju dibuat konfigurasi, bukan konstanta |
| Medusa butuh Redis dan worker terus-menerus; npm supply chain | Kunci versi, lockfile, `npm audit` di CI |
| Jalur payment provider kustom Medusa (jika nanti butuh gateway lain) belum diuji | Spike 0,5 hari di M1 |
| Pertanyaan terbuka: nama merek dan domain demo | Diputuskan di M1 (tidak menghalangi) |

## 12. Distribusi & monetisasi
Dipajang sebagai katalog proyek Upwork dengan tiga paket: Integrasi (Shopify sync + Xero), Toko headless (Medusa + storefront + Stripe), Asisten (RAG + evaluasi); kata kunci: headless commerce, Shopify integration, Xero integration, RAG chatbot. Repo publik dengan README Inggris, video demo 60 detik, laporan evaluasi asisten sebagai bukti. Harga ditetapkan setelah pengecekan Upwork.
