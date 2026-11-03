import { sql } from "drizzle-orm";
import {
  bigint, boolean, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid, vector,
} from "drizzle-orm/pg-core";

export const hub = pgSchema("hub");

/** Satu baris per SKU: dikunci (FOR UPDATE) saat reservasi stok. */
export const sku = hub.table("sku", {
  sku: text("sku").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Stok = SUM(delta) per SKU. source_event_id unik: peristiwa yang sama tidak bisa dihitung dua kali. */
export const inventoryEntry = hub.table("inventory_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  sku: text("sku").notNull().references(() => sku.sku),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  sourceEventId: text("source_event_id").notNull().unique(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("inventory_entry_sku_idx").on(t.sku)]);

export const ledgerOrder = hub.table("ledger_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(), // storefront | shopify
  sourceRef: text("source_ref").notNull(),
  currency: text("currency").notNull(),
  totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  status: text("status").notNull(), // accepted | cannot_fulfil | cancelled
  xeroInvoiceId: text("xero_invoice_id"),
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  // Nomor yang dilihat pembeli (mis. HM-10 atau #1001); dipakai alat lookup_order, bukan id internal.
  orderNumber: text("order_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("ledger_order_source_ref").on(t.source, t.sourceRef)]);

export const ledgerLine = hub.table("ledger_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => ledgerOrder.id),
  sku: text("sku").notNull(),
  qty: integer("qty").notNull(),
  unitMinor: bigint("unit_minor", { mode: "number" }).notNull(),
});

export const webhookReceipt = hub.table("webhook_receipt", {
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.source, t.externalId] })]);

export const outbox = hub.table("outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  topic: text("topic").notNull(),
  payload: jsonb("payload").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  // pending | processing | done | dead | superseded. Hanya "pending" yang digabung (indeks unik parsial),
  // jadi order baru tidak menunggu tugas yang sedang dikirim ke kanal.
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Tugas "pending" untuk kunci yang sama digabung (koalesensi), bukan ditumpuk.
  uniqueIndex("outbox_pending_key").on(t.idempotencyKey).where(sql`status = 'pending'`),
]);

export const run = hub.table("run", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  trigger: text("trigger").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  stats: jsonb("stats"),
  parentId: uuid("parent_id"),
});

export const exceptionItem = hub.table("exception_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id"),
  orderId: uuid("order_id"),
  errorClass: text("error_class").notNull(), // stock | validation | auth | rate_limit | transient
  message: text("message").notNull(),
  payload: jsonb("payload"),
  state: text("state").notNull().default("open"), // open | resolved | ignored
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Koneksi ke layanan eksternal. Rahasia terenkripsi (AES-256-GCM); hanya 4 karakter terakhir yang pernah ditampilkan. */
export const connection = hub.table("connection", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // shopify | xero | stripe
  shop: text("shop").notNull(),
  env: text("env").notNull().default("sandbox"),
  status: text("status").notNull().default("ok"), // ok | failing
  clientId: text("client_id").notNull(),
  secretEnc: text("secret_enc").notNull(),
  secretHint: text("secret_hint").notNull(),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  locationId: text("location_id"),
  locationName: text("location_name"),
  // Pengaturan per koneksi, mis. Xero: { salesAccountCode, bankAccountCode }.
  settings: jsonb("settings"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("connection_kind_shop").on(t.kind, t.shop)]);

/** Pemetaan SKU Weft <-> varian di kanal. weft_sku kosong bila varian tak punya SKU. */
export const skuMap = hub.table("sku_map", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull(),
  channelVariantId: text("channel_variant_id").notNull(),
  inventoryItemId: text("inventory_item_id").notNull(),
  weftSku: text("weft_sku"),
  productTitle: text("product_title").notNull(),
  variantTitle: text("variant_title").notNull(),
  state: text("state").notNull(), // mapped | conflict | missing
  conflictReason: text("conflict_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sku_map_channel_variant").on(t.channel, t.channelVariantId),
  index("sku_map_weft_sku_idx").on(t.channel, t.weftSku),
]);

export const ROLES = ["owner", "ops", "finance", "support"] as const;
export type Role = (typeof ROLES)[number];

export const member = hub.table("member", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(), // owner | ops | finance | support
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("member_email").on(t.email)]);

export const auditLog = hub.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(), // email, atau "system"
  action: text("action").notNull(),
  subject: text("subject").notNull(),
  meta: jsonb("meta"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_log_at_idx").on(t.at)]);

/** Hasil satu rekonsiliasi: selisih terstruktur per SKU antara buku besar Weft dan kanal. */
export const reconciliationReport = hub.table("reconciliation_report", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // stock | xero
  runId: uuid("run_id").notNull(),
  diffs: jsonb("diffs").notNull(),
  summary: jsonb("summary").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});


export const EMBEDDING_DIM = 384; // Xenova/bge-small-en-v1.5

/** Dokumen pengetahuan asisten: kebijakan (berkas) dan katalog (per SKU). */
export const doc = hub.table("doc", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  kind: text("kind").notNull(), // policy | catalog
  sourceKey: text("source_key").notNull(),
  sourceHash: text("source_hash").notNull(),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("doc_source_key").on(t.sourceKey)]);

export const chunk = hub.table("chunk", {
  id: uuid("id").primaryKey().defaultRandom(),
  docId: uuid("doc_id").notNull().references(() => doc.id, { onDelete: "cascade" }),
  ord: integer("ord").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIM }).notNull(),
  metadata: jsonb("metadata"),
}, (t) => [index("chunk_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")), index("chunk_doc_idx").on(t.docId)]);

export const conversation = hub.table("conversation", {
  id: uuid("id").primaryKey().defaultRandom(),
  anonId: text("anon_id").notNull(),
  handoffState: text("handoff_state").notNull().default("none"), // none | requested | taken
  handoffSummary: text("handoff_summary"),
  region: text("region"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
});

export const message = hub.table("message", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // visitor | assistant
  text: text("text").notNull(),
  outcome: text("outcome"), // answered | clarify | handoff | refused | unavailable | disclosure
  toolCalls: jsonb("tool_calls"),
  sources: jsonb("sources"),
  flagged: boolean("flagged").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("message_conversation_idx").on(t.conversationId, t.createdAt)]);

export const EVAL_CATEGORIES = ["answerable", "needs_tool", "must_refuse", "must_handoff"] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export const evalCase = hub.table("eval_case", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(), // stabil, mis. "returns-window"
  question: text("question").notNull(),
  category: text("category").notNull(),
  expect: jsonb("expect").notNull(),
  source: text("source").notNull().default("seed"), // seed | flagged
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("eval_case_key").on(t.key)]);

export const evalRun = hub.table("eval_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"), // running | done | failed
  model: text("model").notNull(),
  scores: jsonb("scores"),
});

export const evalResult = hub.table("eval_result", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => evalRun.id, { onDelete: "cascade" }),
  caseId: uuid("case_id").notNull().references(() => evalCase.id, { onDelete: "cascade" }),
  passed: boolean("passed").notNull(),
  answer: text("answer").notNull(),
  outcome: text("outcome").notNull(),
  toolCalls: jsonb("tool_calls"),
  reasons: jsonb("reasons"),
  numbersWithoutTool: integer("numbers_without_tool").notNull().default(0),
  latencyMs: integer("latency_ms"),
}, (t) => [index("eval_result_run_idx").on(t.runId)]);
