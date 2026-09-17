CREATE TABLE "telephony_server_profiles" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "sip_domain" VARCHAR(255) NOT NULL,
  "proxy_uri" VARCHAR(500),
  "transport" VARCHAR(8) NOT NULL DEFAULT 'TLS',
  "campus_id" VARCHAR(64),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" VARCHAR(64) NOT NULL,
  "updated_by" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "telephony_server_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telephony_user_profiles" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "server_profile_id" UUID NOT NULL,
  "sip_address" VARCHAR(255) NOT NULL,
  "auth_username" VARCHAR(255),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "state" VARCHAR(24) NOT NULL DEFAULT 'INCOMPLETE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "telephony_user_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telephony_pairing_codes" (
  "id" UUID NOT NULL,
  "user_profile_id" UUID NOT NULL,
  "code_digest" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_by" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_pairing_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telephony_workstations" (
  "id" UUID NOT NULL,
  "user_profile_id" UUID NOT NULL,
  "public_id" VARCHAR(80) NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "token_digest" VARCHAR(64) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "connection_state" VARCHAR(24) NOT NULL DEFAULT 'OFFLINE',
  "sip_registered" BOOLEAN NOT NULL DEFAULT false,
  "sdk_loaded" BOOLEAN NOT NULL DEFAULT false,
  "agent_version" VARCHAR(40) NOT NULL,
  "sdk_version" VARCHAR(40) NOT NULL,
  "input_device_id" VARCHAR(255),
  "output_device_id" VARCHAR(255),
  "last_error_code" VARCHAR(80),
  "last_seen_at" TIMESTAMPTZ(6),
  "paired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "telephony_workstations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telephony_agent_commands" (
  "id" UUID NOT NULL,
  "call_id" UUID NOT NULL,
  "workstation_id" UUID NOT NULL,
  "destination_ciphertext" TEXT NOT NULL,
  "destination_iv" VARCHAR(32) NOT NULL,
  "destination_tag" VARCHAR(32) NOT NULL,
  "state" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "claimed_at" TIMESTAMPTZ(6),
  "hangup_requested_at" TIMESTAMPTZ(6),
  "hangup_delivered_at" TIMESTAMPTZ(6),
  "terminal_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "telephony_agent_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telephony_server_profiles_campus_id_name_key" ON "telephony_server_profiles"("campus_id", "name");
CREATE INDEX "telephony_server_profiles_enabled_campus_id_idx" ON "telephony_server_profiles"("enabled", "campus_id");
CREATE UNIQUE INDEX "telephony_user_profiles_user_id_key" ON "telephony_user_profiles"("user_id");
CREATE INDEX "telephony_user_profiles_server_profile_id_enabled_idx" ON "telephony_user_profiles"("server_profile_id", "enabled");
CREATE UNIQUE INDEX "telephony_pairing_codes_code_digest_key" ON "telephony_pairing_codes"("code_digest");
CREATE INDEX "telephony_pairing_codes_user_profile_id_expires_at_idx" ON "telephony_pairing_codes"("user_profile_id", "expires_at");
CREATE UNIQUE INDEX "telephony_workstations_public_id_key" ON "telephony_workstations"("public_id");
CREATE UNIQUE INDEX "telephony_workstations_token_digest_key" ON "telephony_workstations"("token_digest");
CREATE INDEX "telephony_workstations_user_profile_id_active_last_seen_at_idx" ON "telephony_workstations"("user_profile_id", "active", "last_seen_at");
CREATE UNIQUE INDEX "telephony_agent_commands_call_id_key" ON "telephony_agent_commands"("call_id");
CREATE INDEX "telephony_agent_commands_workstation_id_state_expires_at_idx" ON "telephony_agent_commands"("workstation_id", "state", "expires_at");

ALTER TABLE "telephony_user_profiles" ADD CONSTRAINT "telephony_user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telephony_user_profiles" ADD CONSTRAINT "telephony_user_profiles_server_profile_id_fkey" FOREIGN KEY ("server_profile_id") REFERENCES "telephony_server_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telephony_pairing_codes" ADD CONSTRAINT "telephony_pairing_codes_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "telephony_user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telephony_workstations" ADD CONSTRAINT "telephony_workstations_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "telephony_user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telephony_agent_commands" ADD CONSTRAINT "telephony_agent_commands_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "telephony_calls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telephony_agent_commands" ADD CONSTRAINT "telephony_agent_commands_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "telephony_workstations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
