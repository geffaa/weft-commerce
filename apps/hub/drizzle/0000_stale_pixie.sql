CREATE SCHEMA "hub";
--> statement-breakpoint
CREATE TABLE "hub"."exception_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"order_id" uuid,
	"error_class" text NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb,
	"state" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub"."inventory_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"source_event_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_entry_source_event_id_unique" UNIQUE("source_event_id")
);
--> statement-breakpoint
CREATE TABLE "hub"."ledger_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub"."ledger_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"paid_at" timestamp with time zone,
	"status" text NOT NULL,
	"xero_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub"."run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"stats" jsonb,
	"parent_id" uuid
);
--> statement-breakpoint
CREATE TABLE "hub"."sku" (
	"sku" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub"."webhook_receipt" (
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_receipt_source_external_id_pk" PRIMARY KEY("source","external_id")
);
--> statement-breakpoint
ALTER TABLE "hub"."inventory_entry" ADD CONSTRAINT "inventory_entry_sku_sku_sku_fk" FOREIGN KEY ("sku") REFERENCES "hub"."sku"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub"."ledger_line" ADD CONSTRAINT "ledger_line_order_id_ledger_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "hub"."ledger_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_entry_sku_idx" ON "hub"."inventory_entry" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_order_source_ref" ON "hub"."ledger_order" USING btree ("source","source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_pending_key" ON "hub"."outbox" USING btree ("idempotency_key") WHERE status = 'pending';