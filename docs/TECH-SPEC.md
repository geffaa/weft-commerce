# Tech Spec — Weft

## 1. Arsitektur

```
 Pembeli ──► Storefront (Next.js) ──► Medusa v2 (store API, admin, Stripe, wilayah)
                  │ widget chat               │ event: order.placed/paid, inventory.*
                  ▼                           ▼ (subscriber → POST bertanda tangan)
            Hub (NestJS) ◄────────────────────┘
   ┌──────────┬────┴─────┬────────────┬───────────────┐
   │ connections│ sync     │ outbox +   │ assistant     │
   │ (Shopify,  │ (impor,  │ worker     │ (RAG, alat,   │
   │  Xero)     │ webhook, │ (BullMQ)   │  evaluasi)    │
   │            │ rekonsil.)│            │               │
   └──────┬─────┴────┬─────┴─────┬──────┴───────┬───────┘
          ▼          ▼           ▼              ▼
      Shopify    Xero API    PostgreSQL     LLM (Groq/Claude)
     Admin GQL              (+ pgvector)
 Konsol Weft (Next.js) ──► API Hub (JWT)
```

Alasan stack, jujur:
- **Medusa v2** dipakai untuk inti toko karena MIT, paling dikenal klien global, rilis rutin (v2.21–2.22 Sep–Okt 2026; sumber GitHub 2026-11-03). Medusa **tidak** berbasis NestJS (Express + modul/workflow sendiri).
- **NestJS** dipakai untuk hub karena pekerjaan hub adalah backend berstruktur panjang umur (modul, injeksi dependensi, penjadwalan, antrean, validasi, OpenAPI) dan Vendure (berbasis NestJS) menunjukkan pola ini di commerce. Alasan lain terus terang: mengisi portfolio TypeScript/Nest. Bukti permintaan khusus NestJS belum ada di riset.
- **Terpisah dari Medusa** supaya integrasi tidak terikat siklus rilis engine dan bisa dipasang di samping Medusa atau Shopify saja.

## 2. Stack & paket
Monorepo pnpm.

| Paket / app | Fungsi |
|---|---|
| `apps/medusa` | Medusa v2 (modul produk, inventori, wilayah, pembayaran Stripe, pajak manual) |
| `apps/storefront` | Next.js App Router, Tailwind, Medusa JS SDK |
| `apps/hub` | NestJS 11, TypeORM atau Drizzle (diputuskan di M1, satu saja), BullMQ, @nestjs/schedule, class-validator, nestjs-pino |
| `apps/console` | Next.js (konsol operasi), Radix UI headless untuk kontrol form custom, TanStack Table |
| `packages/shared` | Tipe, skema zod, klien API hub |
| DB | PostgreSQL 16 (+ pgvector), Redis (Medusa dan BullMQ) |
| LLM | Antarmuka `LlmProvider`: Groq (openai/gpt-oss-120b) default, Claude opsional; embedding via model terbuka/hosted (dipilih di M4) |
| Tes | Vitest/Jest + Supertest (hub), Playwright (storefront, konsol), set evaluasi RAG |

Versi: stabil terbaru kecuali dikunci (Medusa mengikuti rilis 2.x terbaru saat M1).

## 3. Data model (hub; skema `hub`)
| Entitas | Kolom penting | Dipakai fitur |
|---|---|---|
| `connection` | id, kind (shopify/xero/stripe), env (sandbox/live), status, secret_enc (terenkripsi), scopes, last_checked_at | F3, F5, F11 |
| `sku_map` | id, weft_sku, channel, channel_variant_id, state (mapped/conflict/missing), conflict_reason | F3, F4 |
| `bike_model` | id, make, model, year_from, year_to, engine_cc | F2 |
| `part_fitment` | sku, bike_model_id, position (front/rear/na), note; unik (sku, bike_model_id) | F2, F9 |
| `ledger_order` | id, source (storefront/shopify), source_ref (unik per source), currency, total_minor, paid_at, status, xero_invoice_id | F4, F5 |
| `ledger_line` | order_id, sku, qty, unit_minor | F4 |
| `inventory_entry` | sku, delta, reason, source_event_id (unik), at | F4 |
| `outbox` | id, topic, payload jsonb, idempotency_key (unik), status, attempts, next_attempt_at, last_error | F5, F6 |
| `webhook_receipt` | source, external_id (unik bersama source), received_at | F6 |
| `run` | id, kind, trigger, started_at, finished_at, status, stats jsonb, parent_id | F6, F7, F8 |
| `exception_item` | id, run_id, error_class, message, payload ref, state (open/resolved/ignored), resolved_by | F6, F8 |
| `reconciliation_report` | id, kind (stock/xero), run_id, diffs jsonb, generated_at | F7 |
| `doc` | id, title, kind (policy/catalog), source_hash | F9 |
| `chunk` | doc_id, text, embedding vector, metadata | F9 |
| `conversation`, `message` | id, anon_id, handoff_state; role, text, tool_calls jsonb, sources jsonb | F9 |
| `eval_case`, `eval_run`, `eval_result` | pertanyaan, kategori, ekspektasi; skor; hasil per kasus | F10 |
| `member`, `audit_log` | email, role; actor, action, subject, at | F11 |

Fitment: `bike_model` dan `part_fitment` dimiliki katalog Medusa/seed dan dibaca storefront lewat Store API; hub hanya menyalinnya ke korpus RAG (F9) agar asisten menjawab "apakah ini cocok untuk motor X" dari data, bukan tebakan. Tanpa baris fitment, status adalah "Check fitment", bukan "fits".

Kunci uang: bilangan bulat unit minor + kode mata uang ISO 4217 (JPY 0 desimal, dan lain-lain ditangani tabel eksponen).

## 4. API / route (hub)
| Method · path | Peran | Fitur |
|---|---|---|
| `POST /webhooks/shopify` (HMAC `X-Shopify-Hmac-Sha256`) | publik, diverifikasi | F3, F4 |
| `POST /webhooks/medusa` (HMAC bersama) | publik, diverifikasi | F4, F5 |
| `GET/POST /connections`, `POST /connections/:id/test` | Owner, Ops | F3, F5 |
| `POST /connections/:id/import` | Ops | F3 |
| `GET /runs`, `GET /runs/:id` | Ops, Finance | F6 |
| `GET /exceptions`, `POST /exceptions/:id/retry|ignore` | Ops, Finance | F6 |
| `GET /reconciliation`, `POST /reconciliation/run`, `POST /reconciliation/:id/fix` | Ops | F7 |
| `GET /orders`, `GET /sku-map`, `PATCH /sku-map/:id` | Ops, Finance | F4 |
| `POST /assistant/chat` (SSE) | publik, rate limit | F9 |
| `GET /assistant/conversations`, `POST /assistant/:id/flag` | Support | F9 |
| `POST /knowledge/docs`, `POST /knowledge/reindex` | Owner | F9 |
| `POST /evals/run`, `GET /evals/runs/:id` | Owner | F10 |

Webhook: verifikasi tanda tangan; idempotensi lewat `webhook_receipt(source, external_id)`; jika pemrosesan gagal, receipt dibuang agar pengiriman ulang diproses.

## 5. Logika inti
1. **Buku besar stok.** Stok Weft = jumlah `inventory_entry` per SKU. Setiap event yang mengubah stok punya `source_event_id` unik; penambahan baris yang sama dua kali ditolak oleh constraint. Reservasi pesanan stok terakhir memakai `SELECT ... FOR UPDATE` pada baris SKU agar dua kanal tidak sama-sama lolos.
2. **Dorong stok ke kanal.** Bukan delta, melainkan kuantitas absolut (`inventorySetQuantities` di Shopify dengan nilai pembanding bila tersedia — **verifikasi** nama mutasi dan kebutuhan `changeFromQuantity` pada versi API yang dipakai). Pekerjaan dikoalesensi per SKU agar badai webhook tidak memukul batas laju.
3. **Outbox.** Satu transaksi menulis perubahan domain dan baris `outbox`. Worker mengambil baris `pending` dengan `FOR UPDATE SKIP LOCKED`, memanggil integrasi dengan `idempotency_key`, retry dengan backoff eksponensial plus jitter, lalu dead-letter setelah N percobaan (konfigurasi). Dipilih dibanding antrean saja agar tidak ada jendela "ditulis tapi tidak diantrekan".
4. **Faktur Xero idempoten.** Kunci = `ledger_order.id`; sebelum membuat, cari faktur dengan referensi itu; jika ada, perbarui status saja. Kegagalan terklasifikasi (validation, auth, rate-limit, transient) agar Exceptions menampilkan penyebab terbaca.
5. **Rekonsiliasi.** Tarik stok per varian dari Shopify (paginasi GraphQL) dan bandingkan dengan buku besar; tarik faktur Xero berdasarkan referensi dan bandingkan dengan order terbayar. Hasil menjadi `diffs` terstruktur; "fix" membuat run baru yang menulis ulang sisi kanal dari Weft.
6. **Asisten.** Pipeline: pertanyaan → klasifikasi niat (kebijakan/produk/pesanan/di luar cakupan) → retrieval (pgvector, top-k dengan ambang skor) → bila perlu panggil alat → jawab dengan kutipan. Aturan keras di lapisan kode, bukan hanya prompt: angka harga/stok dalam jawaban dicocokkan dengan hasil alat; jika tidak ada, jawaban diganti serah-terima. Teks pelanggan dan isi dokumen dibungkus sebagai data tidak tepercaya.
7. **Evaluasi.** Kasus berlabel: `answerable`, `needs_tool`, `must_refuse`, `must_handoff`. Penilaian otomatis (kecocokan fakta kunci, ada kutipan, alat dipanggil, penolakan) plus penanda manual untuk ambiguitas. Hasil disimpan per run agar kemajuan terlihat.

## 6. Integrasi pihak ketiga
| Layanan | Untuk apa | Batasan / biaya | Sandbox demo |
|---|---|---|---|
| Shopify Admin GraphQL | impor, webhook, set stok | Laju berbasis biaya; angka berbeda antar sumber (1.000 poin @ 50/dtk vs 2.000 @ 100/dtk) — **verifikasi ke dokumen resmi**. Custom app per toko tidak perlu review | Toko dev gratis, gateway Bogus |
| Xero | faktur + pembayaran | Tier harga baru sejak 2 Mar 2026; tier Starter gratis dibatasi **5 koneksi** (FAQ resmi Xero; angka lama "25 organisasi" keliru); Custom Connection (`client_credentials`, token 30 menit) gratis untuk Demo Company, berbayar sekitar USD 5/bulan per organisasi nyata (halaman harga, usia ±1 tahun, **verifikasi**); scope granular `accounting.invoices|payments|contacts|settings.read` sejak 2026 | Demo company |
| Stripe | pembayaran toko | Tarif standar (sekitar 2,9% + 30¢ AS; **verifikasi**); 3DS lewat PaymentIntents | Mode uji |
| Groq / Claude | LLM asisten | Groq GPT-OSS-120B sekitar $0,15 / $0,60 per juta token; Haiku 5.5 $0,10 / $0,50 (halaman harga, 2026-11-03) | Kunci uji milik developer |
| (P2) WooCommerce REST | kanal kedua | Gratis | WP lokal |

## 7. Keamanan
- Auth konsol: login email + kata sandi (Argon2id) atau magic link; JWT berumur pendek; peran Owner/Ops/Finance/Support dengan guard NestJS.
- Rahasia koneksi dienkripsi AES-256-GCM, tidak pernah ditampilkan ulang (hanya empat karakter terakhir).
- Semua webhook diverifikasi HMAC; asisten publik dibatasi laju per IP dan per percakapan.
- `lookup_order` mensyaratkan nomor pesanan + email yang cocok, jawaban minimal (status, bukan alamat penuh).
- Audit log untuk: simpan/ubah koneksi, retry/ignore exception, fix rekonsiliasi, ubah peran, ubah dokumen pengetahuan.
- Rantai pasok: lockfile, `pnpm audit`, versi dikunci, tanpa skrip postinstall yang tak perlu.

## 8. Strategi tes
- **Unit:** buku besar stok (idempotensi, urutan), klasifikasi error, backoff, penilai evaluasi, kecocokan angka-ke-alat.
- **Kontrak/HTTP (Supertest):** HMAC salah → 401; webhook ganda → satu efek; peran ditolak; tenant tunggal.
- **Konkurensi:** 50 order bersamaan untuk stok 10 dari dua sumber → tepat 10 sukses.
- **Ketahanan:** matikan worker di tengah pekerjaan → lanjut sekali.
- **Replay:** 10.000 event diputar ulang → 0 faktur ganda.
- **E2E (Playwright):** pembelian Stripe uji (termasuk kartu 3DS), konsol menampilkan order + faktur, kegagalan Xero muncul di Exceptions dan bisa di-retry.
- **RAG:** set evaluasi 60 kasus; gerbang rilis: ≥ 85% lulus dan 0 jawaban harga/stok tanpa alat.
- Milestone selesai bila semua tes tingkat itu hijau.

## 9. Deploy & lingkungan
Demo lokal dengan Docker Compose (Postgres+pgvector, Redis, Medusa, hub, storefront, konsol). Seed data fiktif berlabel synthetic: toko dev Shopify diisi oleh skrip seed. Variabel lingkungan: `DATABASE_URL`, `REDIS_URL`, `SHOPIFY_*`, `XERO_*`, `STRIPE_*`, `LLM_*`, `HUB_SECRET_KEY`. Deploy publik sengaja ditunda sampai M5 (mode sandbox saja, label jelas).
