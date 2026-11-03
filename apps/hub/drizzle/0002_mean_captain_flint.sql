CREATE TABLE "hub"."connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"shop" text NOT NULL,
	"env" text DEFAULT 'sandbox' NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"client_id" text NOT NULL,
	"secret_enc" text NOT NULL,
	"secret_hint" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"location_id" text,
	"location_name" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub"."sku_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"channel_variant_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"weft_sku" text,
	"product_title" text NOT NULL,
	"variant_title" text NOT NULL,
	"state" text NOT NULL,
	"conflict_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "connection_kind_shop" ON "hub"."connection" USING btree ("kind","shop");--> statement-breakpoint
CREATE UNIQUE INDEX "sku_map_channel_variant" ON "hub"."sku_map" USING btree ("channel","channel_variant_id");--> statement-breakpoint
CREATE INDEX "sku_map_weft_sku_idx" ON "hub"."sku_map" USING btree ("channel","weft_sku");