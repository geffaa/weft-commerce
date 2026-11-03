import { z } from "zod";

const schema = z.object({
  DATABASE_URL_HUB: z.string().default("postgres://weft:weft@localhost:54330/hub"),
  // Webhook app Shopify ditandatangani dengan client secret app; jadi bila tak diisi, pakai itu.
  SHOPIFY_WEBHOOK_SECRET: z.string().min(1).default("dev-shopify-secret"),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  MEDUSA_WEBHOOK_SECRET: z.string().min(1).default("dev-medusa-secret"),
  PORT: z.coerce.number().default(3100),
  // Jam UTC (0-23) rekonsiliasi malam; kosong = tidak dijadwalkan (jalankan manual lewat API).
  RECON_AT_UTC_HOUR: z.coerce.number().int().min(0).max(23).optional(),
  // Kunci AES-256 (64 hex) untuk rahasia koneksi. Default hanya untuk dev; wajib di produksi.
  HUB_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/).default("0".repeat(63) + "1"),
  // Penandatangan JWT sesi konsol (HS256). Default hanya untuk dev.
  HUB_JWT_SECRET: z.string().min(16).default("dev-jwt-secret-change-me"),
  HUB_JWT_TTL_SECONDS: z.coerce.number().default(900),
  // Pemilik pertama dibuat saat start bila belum ada anggota.
  HUB_OWNER_EMAIL: z.string().email().optional(),
  HUB_OWNER_PASSWORD: z.string().min(12).optional(),
  // Interval polling worker outbox (ms); 0 = nonaktif (dipakai tes, yang memanggil tick() sendiri).
  OUTBOX_POLL_MS: z.coerce.number().default(2000),
});
const guarded = schema.superRefine((v, ctx) => {
  if (process.env.NODE_ENV === "production" && (v.HUB_JWT_SECRET === "dev-jwt-secret-change-me" || /^0+1$/.test(v.HUB_ENCRYPTION_KEY)))
    ctx.addIssue({ code: "custom", message: "Set HUB_JWT_SECRET and HUB_ENCRYPTION_KEY in production" });
});
export type Env = z.infer<typeof schema>;
export const loadEnv = (src: NodeJS.ProcessEnv = process.env): Env => {
  const v = guarded.parse(src);
  return src.SHOPIFY_WEBHOOK_SECRET || !v.SHOPIFY_CLIENT_SECRET ? v : { ...v, SHOPIFY_WEBHOOK_SECRET: v.SHOPIFY_CLIENT_SECRET };
};
