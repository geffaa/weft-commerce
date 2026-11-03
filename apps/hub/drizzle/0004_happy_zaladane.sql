CREATE TABLE "hub"."reconciliation_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"run_id" uuid NOT NULL,
	"diffs" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
