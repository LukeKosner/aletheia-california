ALTER TABLE "interview"."session" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "interview"."session" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "interview"."study" ADD COLUMN "fields" jsonb;--> statement-breakpoint
ALTER TABLE "interview"."study" ADD COLUMN "interview_target" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview"."study" ADD COLUMN "price_cents" integer DEFAULT 14900 NOT NULL;