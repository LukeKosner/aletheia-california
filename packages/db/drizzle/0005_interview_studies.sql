CREATE TABLE "interview"."study" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sponsor_kind" text NOT NULL,
	"sponsor_name" text NOT NULL,
	"title" text NOT NULL,
	"goal" text NOT NULL,
	"questions" text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview"."session" ADD COLUMN "study_id" uuid;--> statement-breakpoint
ALTER TABLE "interview"."session" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "interview"."session" ADD CONSTRAINT "session_study_id_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "interview"."study"("id") ON DELETE set null ON UPDATE no action;