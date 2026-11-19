CREATE TYPE "public"."bill_author_role" AS ENUM('lead', 'coauthor');--> statement-breakpoint
CREATE TYPE "public"."claim_confidence" AS ENUM('high', 'likely');--> statement-breakpoint
CREATE TYPE "public"."claim_verdict" AS ENUM('supported', 'overstated', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('open', 'fixed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('person', 'org', 'committee', 'candidate', 'measure', 'legislator', 'lobby_firm', 'official');--> statement-breakpoint
CREATE TYPE "public"."money_edge_kind" AS ENUM('contribution', 'transfer', 'ie_support', 'ie_oppose', 'expenditure', 'loan');--> statement-breakpoint
CREATE TYPE "public"."vote_result" AS ENUM('aye', 'no', 'nvr');--> statement-breakpoint
CREATE TABLE "bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session" text NOT NULL,
	"measure" text NOT NULL,
	"title" text,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "bill_author" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bill_id" uuid NOT NULL,
	"legislator_entity" uuid NOT NULL,
	"role" "bill_author_role" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"investigation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"method_version" text,
	"published" boolean DEFAULT false NOT NULL,
	"image_path" text
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"investigation_id" uuid NOT NULL,
	"sentence" text NOT NULL,
	"edge_ids" uuid[] DEFAULT '{}' NOT NULL,
	"filing_ids" uuid[] DEFAULT '{}' NOT NULL,
	"confidence" "claim_confidence",
	"verdict" "claim_verdict",
	"verifier_model" text
);
--> statement-breakpoint
CREATE TABLE "correction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"card_id" uuid NOT NULL,
	"request" text NOT NULL,
	"status" "correction_status" DEFAULT 'open' NOT NULL,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"name" text NOT NULL,
	"canonical_key" text NOT NULL,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "entity_canonical_key_unique" UNIQUE("canonical_key")
);
--> statement-breakpoint
CREATE TABLE "entity_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_id" uuid NOT NULL,
	"raw_name" text NOT NULL,
	"source" text NOT NULL,
	"source_row_id" text,
	"match_score" real,
	"method" text
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"campus" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"user_id" text,
	"choice" text,
	"text" text
);
--> statement-breakpoint
CREATE TABLE "filing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"filing_id" text NOT NULL,
	"amendment_no" integer DEFAULT 0 NOT NULL,
	"form" text,
	"filed_at" timestamp with time zone,
	"period_start" date,
	"period_end" date,
	"url" text,
	"raw_sha256" text
);
--> statement-breakpoint
CREATE TABLE "interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"official_entity" uuid NOT NULL,
	"year" integer NOT NULL,
	"business_entity" uuid,
	"kind" text,
	"value_range" text,
	"filing_id" uuid
);
--> statement-breakpoint
CREATE TABLE "investigation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"question" text NOT NULL,
	"status" text NOT NULL,
	"user_id" text,
	"harness_task_id" text,
	"cost_usd" numeric(12, 6),
	"tokens" integer,
	"method_version" text
);
--> statement-breakpoint
CREATE TABLE "lobby_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"employer_entity" uuid NOT NULL,
	"firm_entity" uuid,
	"period_start" date,
	"period_end" date,
	"amount" numeric(14, 2),
	"filing_id" uuid,
	"bills" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_edge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_entity" uuid NOT NULL,
	"to_entity" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"date" date,
	"kind" "money_edge_kind" NOT NULL,
	"filing_id" uuid,
	"schedule" text,
	"line_item" text
);
--> statement-breakpoint
CREATE TABLE "vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bill_id" uuid NOT NULL,
	"legislator_entity" uuid NOT NULL,
	"vote_date" date,
	"motion" text,
	"location" text,
	"result" "vote_result" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_author" ADD CONSTRAINT "bill_author_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_author" ADD CONSTRAINT "bill_author_legislator_entity_entity_id_fk" FOREIGN KEY ("legislator_entity") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_investigation_id_investigation_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_investigation_id_investigation_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction" ADD CONSTRAINT "correction_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_alias" ADD CONSTRAINT "entity_alias_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest" ADD CONSTRAINT "interest_official_entity_entity_id_fk" FOREIGN KEY ("official_entity") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest" ADD CONSTRAINT "interest_business_entity_entity_id_fk" FOREIGN KEY ("business_entity") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest" ADD CONSTRAINT "interest_filing_id_filing_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_activity" ADD CONSTRAINT "lobby_activity_employer_entity_entity_id_fk" FOREIGN KEY ("employer_entity") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_activity" ADD CONSTRAINT "lobby_activity_firm_entity_entity_id_fk" FOREIGN KEY ("firm_entity") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_activity" ADD CONSTRAINT "lobby_activity_filing_id_filing_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_edge" ADD CONSTRAINT "money_edge_from_entity_entity_id_fk" FOREIGN KEY ("from_entity") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_edge" ADD CONSTRAINT "money_edge_to_entity_entity_id_fk" FOREIGN KEY ("to_entity") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_edge" ADD CONSTRAINT "money_edge_filing_id_filing_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_legislator_entity_entity_id_fk" FOREIGN KEY ("legislator_entity") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_session_measure_uq" ON "bill" USING btree ("session","measure");--> statement-breakpoint
CREATE INDEX "bill_author_bill_idx" ON "bill_author" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bill_author_legislator_idx" ON "bill_author" USING btree ("legislator_entity");--> statement-breakpoint
CREATE INDEX "card_investigation_idx" ON "card" USING btree ("investigation_id");--> statement-breakpoint
CREATE INDEX "claim_investigation_idx" ON "claim" USING btree ("investigation_id");--> statement-breakpoint
CREATE INDEX "correction_card_idx" ON "correction" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "entity_alias_entity_idx" ON "entity_alias" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_alias_raw_name_idx" ON "entity_alias" USING btree ("raw_name");--> statement-breakpoint
CREATE INDEX "event_name_idx" ON "event" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "filing_source_filing_amendment_uq" ON "filing" USING btree ("source","filing_id","amendment_no");--> statement-breakpoint
CREATE INDEX "interest_official_idx" ON "interest" USING btree ("official_entity");--> statement-breakpoint
CREATE INDEX "lobby_activity_employer_idx" ON "lobby_activity" USING btree ("employer_entity");--> statement-breakpoint
CREATE INDEX "lobby_activity_firm_idx" ON "lobby_activity" USING btree ("firm_entity");--> statement-breakpoint
CREATE INDEX "money_edge_from_idx" ON "money_edge" USING btree ("from_entity");--> statement-breakpoint
CREATE INDEX "money_edge_to_idx" ON "money_edge" USING btree ("to_entity");--> statement-breakpoint
CREATE INDEX "money_edge_filing_idx" ON "money_edge" USING btree ("filing_id");--> statement-breakpoint
CREATE INDEX "vote_bill_idx" ON "vote" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "vote_legislator_idx" ON "vote" USING btree ("legislator_entity");