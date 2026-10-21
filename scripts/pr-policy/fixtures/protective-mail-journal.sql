-- Additive only. No historical backfill, dispatch, permission grant or existing row mutation.
-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
CREATE TABLE "business_mail_deliveries" (
  "key" VARCHAR(64) PRIMARY KEY CHECK ("key" ~ '^[a-f0-9]{64}$'),
  "event_type" VARCHAR(40) NOT NULL CHECK ("event_type" IN ('FOLLOW_UP_DUE','FOLLOW_UP_OVERDUE','FIRST_TREATMENT_OVERDUE','CONFIRMATION_EXPECTED','RETURN_EXPECTED')),
  "resource_id" VARCHAR(100) NOT NULL,
  "template_version" VARCHAR(24) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL CHECK ("fingerprint" ~ '^[a-f0-9]{64}$'),
  "recipient_user_ids" JSONB NOT NULL CHECK (jsonb_typeof("recipient_user_ids") = 'array' AND jsonb_array_length("recipient_user_ids") BETWEEN 1 AND 1000),
  "status" VARCHAR(16) NOT NULL DEFAULT 'SENDING' CHECK ("status" IN ('SENDING','ACCEPTED','UNCERTAIN')),
  "sending_token" UUID NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sending_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMPTZ(6),
  "uncertain_at" TIMESTAMPTZ(6),
  "provider_message_id" VARCHAR(128),
  "uncertainty_code" VARCHAR(40),
  CONSTRAINT "business_mail_delivery_state_coherent" CHECK (
    ("status" = 'SENDING' AND "accepted_at" IS NULL AND "uncertain_at" IS NULL AND "provider_message_id" IS NULL AND "uncertainty_code" IS NULL)
    OR ("status" = 'ACCEPTED' AND "accepted_at" IS NOT NULL AND "uncertain_at" IS NULL AND "provider_message_id" IS NOT NULL AND "provider_message_id" ~ '^[a-zA-Z0-9_-]{1,128}$' AND "uncertainty_code" IS NULL)
    OR ("status" = 'UNCERTAIN' AND "accepted_at" IS NULL AND "uncertain_at" IS NOT NULL AND "provider_message_id" IS NULL AND "uncertainty_code" IS NOT NULL AND "uncertainty_code" IN ('TRANSPORT_UNCONFIRMED','PROCESS_INTERRUPTED','ACCEPTANCE_COMMIT_UNCONFIRMED'))
  )
);
CREATE INDEX "business_mail_deliveries_status_sending_at_idx" ON "business_mail_deliveries"("status", "sending_at");

CREATE FUNCTION "business_mail_delivery_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'business_mail_journal_delete_forbidden' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'SENDING' THEN
      RAISE EXCEPTION 'business_mail_journal_initial_state_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF ROW(NEW.key,NEW.event_type,NEW.resource_id,NEW.template_version,NEW.fingerprint,NEW.recipient_user_ids,NEW.sending_token,NEW.created_at,NEW.sending_at)
    IS DISTINCT FROM ROW(OLD.key,OLD.event_type,OLD.resource_id,OLD.template_version,OLD.fingerprint,OLD.recipient_user_ids,OLD.sending_token,OLD.created_at,OLD.sending_at)
    OR OLD.status <> 'SENDING' OR NEW.status NOT IN ('ACCEPTED','UNCERTAIN') THEN
    RAISE EXCEPTION 'business_mail_journal_transition_forbidden' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "business_mail_delivery_guard" BEFORE INSERT OR UPDATE OR DELETE ON "business_mail_deliveries"
FOR EACH ROW EXECUTE FUNCTION "business_mail_delivery_guard"();
CREATE TRIGGER "business_mail_delivery_truncate_guard" BEFORE TRUNCATE ON "business_mail_deliveries"
FOR EACH STATEMENT EXECUTE FUNCTION "business_mail_delivery_guard"();
