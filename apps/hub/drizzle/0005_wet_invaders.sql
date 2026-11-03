ALTER TABLE "hub"."connection" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "hub"."ledger_order" ADD COLUMN "customer_email" text;--> statement-breakpoint
ALTER TABLE "hub"."ledger_order" ADD COLUMN "customer_name" text;