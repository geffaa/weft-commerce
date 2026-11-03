# Information architecture — Weft

Disusun dari bentuk akhir produk (fase 3), bukan dari MVP.

## 1. Peran dan permukaan

| Peran | Perangkat / situasi | Permukaan | Pekerjaan utama |
|---|---|---|---|
| Pembeli | Ponsel dan desktop, dari iklan atau pencarian | Storefront + widget asisten | Menemukan, membayar dalam mata uangnya, bertanya tanpa menunggu |
| Operator (Ops) | Desktop, memantau pagi dan sore | Konsol Weft | Memastikan stok dan order cocok di semua kanal; menyelesaikan exception |
| Finance | Desktop, akhir hari/bulan | Konsol Weft (Orders, Xero) | Setiap order terbayar punya faktur; selisih dijelaskan |
| Support | Desktop, sepanjang hari | Konsol Weft (Assistant) | Menerima serah-terima, menandai jawaban AI yang salah |
| Owner / pemilik merek | Ponsel dan desktop | Medusa Admin (katalog) + konsol (ringkasan) | Mengelola katalog, wilayah, harga, dan peran |
| Developer klien | Terminal | API, webhook keluar, repo | Memperluas dan memasang |

Dua admin sengaja dipisah: **Medusa Admin** untuk katalog dan pesanan toko (disediakan engine), **Konsol Weft** untuk apa yang hanya Weft punya: integrasi, rekonsiliasi, asisten.

## 2. Peta modul semua fase

```
Konsol Weft
├─ Overview            kesehatan semua jalur (MVP)
├─ Commerce
│  ├─ Orders (ledger)  semua kanal, status Xero (MVP)
│  └─ Products         pemetaan SKU kanal (MVP)
├─ Channels
│  ├─ Shopify          (MVP)   Woo (P2)   Amazon/Etsy/TikTok (P3)
├─ Finance
│  └─ Xero             (MVP)   QuickBooks (P2)
├─ Assistant
│  ├─ Conversations    (MVP)
│  ├─ Knowledge        (MVP)
│  └─ Evals            (MVP)
├─ Operations
│  ├─ Runs             (MVP)
│  ├─ Exceptions       (MVP)
│  └─ Reconciliation   (MVP)
└─ Settings            markets, koneksi, anggota, kunci API
```

## 3. Alur end-to-end

1. **Katalog masuk:** Owner menghubungkan Shopify → hub mengimpor produk/stok → pemetaan SKU dibuat → konflik (SKU kembar, hilang) muncul di Products → operator menyelesaikannya.
2. **Order terjadi:** pembeli membayar di storefront (Stripe) atau di Shopify → order masuk ke ledger terpadu → stok berkurang di buku besar → hub mendorong stok baru ke kanal lain.
3. **Order masuk ke keuangan:** order terbayar → hub membuat faktur + pembayaran di Xero (idempoten) → bila gagal, masuk Exceptions dengan penyebab terbaca.
4. **Rekonsiliasi malam:** hub membandingkan stok per kanal dan order vs Xero → selisih tampil di Reconciliation dengan tombol "perbaiki" yang membuat run baru.
5. **Pembeli bertanya:** widget asisten menjawab dari katalog/kebijakan dengan sumber, memeriksa pesanan lewat alat, atau menyerahkan ke Support → Support menandai jawaban salah → pertanyaan itu masuk ke set evaluasi.
6. **Perbaikan:** skor evaluasi turun → Owner memperbarui dokumen di Knowledge → evaluasi dijalankan ulang → skor naik.

## 4. Keputusan navigasi

| Keputusan | Alasan | Trade-off |
|---|---|---|
| **Rel kiri bergrup dengan label teks** (Commerce, Channels, Finance, Assistant, Operations) | Konsol punya sekitar 10 area dengan nama panjang; operator harus menemukannya tanpa menghafal ikon. Berbeda dari rel ikon gelap Relay dan sidebar akordeon Roster | Memakan 232px lebar; di ponsel menjadi menu geser |
| **Pemilih lingkungan (Sandbox / Live) di bilah atas**, selalu terlihat | Kesalahan paling mahal di produk ini adalah menulis ke akun Live saat mengira uji | Satu elemen tetap yang memakan ruang |
| **Exceptions dipromosikan ke tingkat atas Operations dengan hitungan di rel** | Pekerjaan harian operator adalah mengosongkan antrean ini | Menyembunyikan sub-bagian lain |
| Koneksi sebagai halaman (bukan modal) | Perlu menampilkan scope, status, dan uji coba berdampingan | Satu klik lebih jauh dari Overview |
| Dua admin (Medusa Admin dan Konsol) dengan tautan silang | Tidak menulis ulang editor katalog yang sudah ada | Dua login; mitigasi: SSO di P2 |
