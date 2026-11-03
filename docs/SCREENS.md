# Screens — Weft

Mode Impeccable per layar. Konsol = **Operate**; storefront = **Persuade**/**Operate** (checkout).

| ID | Layar | Peran | Mode | Fitur PRD | Mockup? |
|---|---|---|---|---|---|
| S01 | Overview (kesehatan jalur) | Ops, Finance, Owner | Operate | F8 | tidak |
| S02 | Connections | Owner, Ops | Operate | F3, F5, F11 | tidak |
| S03 | Runs (riwayat + detail) | Ops | Operate | F6 | ya (digabung S04) |
| S04 | Exceptions | Ops, Finance | Operate | F5, F6 | **ya** |
| S05 | Reconciliation | Ops | Operate | F7 | **ya** |
| S06 | Products (pemetaan SKU) | Ops | Operate | F3, F4 | tidak |
| S07 | Orders (ledger terpadu) | Ops, Finance | Operate | F4, F5 | tidak |
| S08 | Assistant → Conversations | Support | Read | F9 | **ya** |
| S09 | Assistant → Knowledge | Owner | Operate | F9 | tidak |
| S10 | Assistant → Evals | Owner | Read | F10 | **ya** (digabung S08) |
| S11 | Settings (markets, anggota, kunci) | Owner | Operate | F1, F11 | tidak |
| S12 | Storefront: beranda dan koleksi | Pembeli | Persuade | F1, F2 | tidak |
| S13 | Storefront: PDP | Pembeli | Persuade | F1, F2 | tidak |
| S14 | Storefront: keranjang | Pembeli | Operate | F2 | tidak |
| S15 | Storefront: checkout | Pembeli | Operate | F1, F2 | tidak |
| S16 | Storefront: status pesanan + widget asisten | Pembeli | Operate | F2, F9 | tidak |

Mockup dipilih untuk mekanisme khas Weft: **Exceptions/Runs** (keandalan), **Reconciliation** (bukti buku besar), **Assistant review + Evals** (bukti AI tidak mengarang). Storefront (S12 koleksi, S13 PDP, plus pencarian) dimockup untuk merchant fiktif Halden Moto Parts (suku cadang motor, tema "calm catalogue" dengan fitment): `mockups/storefront-collection.html`, `storefront-pdp.html`, `storefront-search.html`. S14-S16 belum dimockup. Foto dari Wikimedia Commons (lisensi di `mockups/img/credits.json`).

## S01 — Overview
- **Tujuan:** melihat dalam lima detik apakah semuanya sehat.
- **Isi:** tiga jalur (Shopify, Xero, Assistant) dengan status, run terakhir, exception terbuka; hitungan selisih rekonsiliasi terakhir; order 24 jam dan yang belum berfaktur.
- **Aksi:** buka jalur; jalankan impor/rekonsiliasi.
- **State:** kosong (belum ada koneksi: ajakan menghubungkan Shopify), error (jalur terputus: merah dengan penyebab), loading (skeleton baris).

## S02 — Connections
- **Tujuan:** menyimpan dan menguji akses ke Shopify/Xero/Stripe tanpa menebak.
- **Isi:** kartu per koneksi (status, lingkungan, scope diminta vs diberikan, uji terakhir). **Aksi:** simpan token, uji koneksi, impor, putuskan. **State:** token salah menyebut scope kurang; sandbox vs live berbeda warna label.

## S03 — Runs
- **Isi:** tabel run (jenis, pemicu, durasi, hasil, jumlah item), panel detail dengan payload (monospace) dan garis waktu langkah. **Aksi:** ulang run, salin id. **State:** run berjalan (progres), run parsial, run dengan 10.000 item (paginasi).

## S04 — Exceptions (mockup)
- **Tujuan:** mengosongkan antrean pekerjaan yang gagal.
- **Isi:** daftar bergrup per kelas error (validation, auth, rate limit, stock, transient), kolom order/SKU, penyebab dalam bahasa biasa, percobaan ke-n, usia. Panel kanan: payload, jawaban API mentah, saran perbaikan. **Aksi utama:** Retry; sekunder: Ignore dengan alasan, Retry semua yang sejenis. **State:** kosong ("Nothing needs attention"), banyak (grup dilipat), izin ditolak (Support).
- **Data contoh:** "Xero rejected invoice: account code 200 does not exist" untuk order #WF-10482 (synthetic).

## S05 — Reconciliation (mockup)
- **Isi:** ringkasan (varian dicek, cocok, selisih), tabel selisih: SKU, Weft, Shopify, selisih, kemungkinan penyebab; tab Xero: order tanpa faktur. **Aksi:** Fix dari Weft (membuat run), tandai diterima. **State:** nol selisih (bukti), run gagal sebagian.

## S08 — Conversations (mockup)
- **Isi:** daftar percakapan (status: dijawab AI / dialihkan / ditandai), transkrip dengan kutipan sumber, panggilan alat dan hasilnya (garis tipis), pengungkapan AI. **Aksi:** tandai salah (jadi kasus evaluasi), ambil alih. **State:** percakapan panjang, serah-terima menunggu, sumber dihapus.

## S10 — Evals (mockup)
- **Isi:** skor total, skor per kategori (answerable, needs_tool, must_refuse, must_handoff), jumlah "angka tanpa alat" (harus 0), daftar kasus gagal dengan jawaban vs yang diharapkan, tren antar run. **Aksi:** jalankan evaluasi, bandingkan run.

## S06, S07, S09, S11–S16
Dirinci saat dibangun; kontrol dan state mengikuti pola S02–S05. S15 mengikuti urutan Medusa starter: kontak → alamat → pengiriman → pembayaran (Stripe Elements), dengan wilayah dan mata uang tetap terlihat.
