ALTER TABLE "activities" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "deleted_at" timestamp with time zone;