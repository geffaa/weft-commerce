CREATE TABLE "hub"."chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "hub"."conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anon_id" text NOT NULL,
	"handoff_state" text DEFAULT 'none' NOT NULL,
	"handoff_summary" text,
	"region" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub"."doc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"source_hash" text NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub"."eval_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"question" text NOT NULL,
	"category" text NOT NULL,
	"expect" jsonb NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub"."eval_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"passed" boolean NOT NULL,
	"answer" text NOT NULL,
	"outcome" text NOT NULL,
	"tool_calls" jsonb,
	"reasons" jsonb,
	"numbers_without_tool" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer
);
--> statement-breakpoint
CREATE TABLE "hub"."eval_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"model" text NOT NULL,
	"scores" jsonb
);
--> statement-breakpoint
CREATE TABLE "hub"."message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"outcome" text,
	"tool_calls" jsonb,
	"sources" jsonb,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub"."ledger_order" ADD COLUMN "order_number" text;--> statement-breakpoint
ALTER TABLE "hub"."chunk" ADD CONSTRAINT "chunk_doc_id_doc_id_fk" FOREIGN KEY ("doc_id") REFERENCES "hub"."doc"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub"."eval_result" ADD CONSTRAINT "eval_result_run_id_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "hub"."eval_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub"."eval_result" ADD CONSTRAINT "eval_result_case_id_eval_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "hub"."eval_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub"."message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "hub"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_embedding_idx" ON "hub"."chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunk_doc_idx" ON "hub"."chunk" USING btree ("doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_source_key" ON "hub"."doc" USING btree ("source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_case_key" ON "hub"."eval_case" USING btree ("key");--> statement-breakpoint
CREATE INDEX "eval_result_run_idx" ON "hub"."eval_result" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "hub"."message" USING btree ("conversation_id","created_at");