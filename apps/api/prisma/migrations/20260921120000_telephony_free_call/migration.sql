ALTER TABLE "telephony_calls"
  ADD COLUMN "purpose_code" VARCHAR(64),
  ADD COLUMN "purpose_comment" VARCHAR(500);
