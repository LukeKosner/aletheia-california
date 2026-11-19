CREATE SCHEMA "interview";
--> statement-breakpoint
CREATE TABLE "interview"."payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid,
	"product" text NOT NULL,
	"stripe_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview"."payout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stripe_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "interview"."research" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid,
	"origin" text NOT NULL,
	"question" text NOT NULL,
	"investigation_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "interview"."session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"county" text NOT NULL,
	"age_range" text NOT NULL,
	"party" text NOT NULL,
	"vote_likelihood" text NOT NULL,
	"public_consent" boolean NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" text[] DEFAULT '{}' NOT NULL,
	"questions" text[] DEFAULT '{}' NOT NULL,
	"candidate_views" text[] DEFAULT '{}' NOT NULL,
	"summary" text,
	"wants_research" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "interview"."payment" ADD CONSTRAINT "payment_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "interview"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview"."research" ADD CONSTRAINT "research_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "interview"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_payment_stripe_idx" ON "interview"."payment" USING btree ("stripe_id");--> statement-breakpoint
CREATE INDEX "interview_research_session_idx" ON "interview"."research" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "interview_research_origin_idx" ON "interview"."research" USING btree ("origin");--> statement-breakpoint
CREATE INDEX "interview_session_status_idx" ON "interview"."session" USING btree ("status");--> statement-breakpoint
CREATE INDEX "interview_session_county_idx" ON "interview"."session" USING btree ("county");