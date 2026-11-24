-- Migration: auth_login_mfa
-- Prisma-generated DDL first, then hand-written SQL (D-001). Hand-written objects:
--   checks   user_staff_id_format, user_email_format, user_display_name_length,
--            session_stage_expiry, session_expiry_after_creation, session_unlock_failures,
--            login_throttle_failed_count, recovery_code_used_after_created
--   index    mfa_secret_one_active_per_user (partial unique)
--   grants   hms_app: no DELETE on user, mfa_secret, recovery_code, session, device
-- Reverse: down.sql in this folder.

-- CreateEnum
CREATE TYPE "SessionStage" AS ENUM ('password_change_required', 'mfa_enrollment_required', 'mfa_pending', 'active');

-- CreateEnum
CREATE TYPE "MfaStatus" AS ENUM ('pending', 'active', 'revoked');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "staff_id" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by_id" UUID,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "mfa_secret" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MfaStatus" NOT NULL,
    "secret_ciphertext" BYTEA NOT NULL,
    "secret_iv" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "mfa_secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_code" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mfa_secret_id" UUID NOT NULL,
    "code_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "active_role" "Role" NOT NULL,
    "stage" "SessionStage" NOT NULL,
    "stage_expires_at" TIMESTAMPTZ(6),
    "mfa_verified_at" TIMESTAMPTZ(6),
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "locked_at" TIMESTAMPTZ(6),
    "unlock_failures" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    "revoked_by_id" UUID,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" UUID NOT NULL,
    "label" TEXT,
    "user_agent" TEXT,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_throttle" (
    "key_hash" BYTEA NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "first_failed_at" TIMESTAMPTZ(6),
    "locked_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_throttle_pkey" PRIMARY KEY ("key_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_staff_id_key" ON "user"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "mfa_secret_user_id_idx" ON "mfa_secret"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_code_code_hash_key" ON "recovery_code"("code_hash");

-- CreateIndex
CREATE INDEX "recovery_code_user_id_idx" ON "recovery_code"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_secret" ADD CONSTRAINT "mfa_secret_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_mfa_secret_id_fkey" FOREIGN KEY ("mfa_secret_id") REFERENCES "mfa_secret"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================== Hand-written SQL (not managed by Prisma) =====================

-- Identifiers are stored normalised so lookups and uniqueness are case-insensitive.
ALTER TABLE "user"
  ADD CONSTRAINT "user_staff_id_format"
    CHECK ("staff_id" ~ '^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$'),
  ADD CONSTRAINT "user_email_format"
    CHECK ("email" IS NULL OR ("email" = lower(btrim("email")) AND "email" ~ '^[^@\s]+@[^@\s]+$')),
  ADD CONSTRAINT "user_display_name_length"
    CHECK (char_length(btrim("display_name")) BETWEEN 1 AND 120);

-- A session that is not fully signed in must have a short deadline; an active one must not.
ALTER TABLE "session"
  ADD CONSTRAINT "session_stage_expiry"
    CHECK (("stage" = 'active') = ("stage_expires_at" IS NULL)),
  ADD CONSTRAINT "session_expiry_after_creation"
    CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "session_unlock_failures"
    CHECK ("unlock_failures" >= 0);

ALTER TABLE "login_throttle"
  ADD CONSTRAINT "login_throttle_failed_count" CHECK ("failed_count" >= 0);

ALTER TABLE "recovery_code"
  ADD CONSTRAINT "recovery_code_used_after_created"
    CHECK ("used_at" IS NULL OR "used_at" >= "created_at");

-- At most one active TOTP secret per user.
CREATE UNIQUE INDEX "mfa_secret_one_active_per_user"
  ON "mfa_secret" ("user_id") WHERE "status" = 'active';

-- Accounts are disabled, sessions revoked, secrets revoked, codes marked used:
-- the app never deletes these rows, so it is not allowed to.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_app') THEN
    REVOKE DELETE, TRUNCATE ON "user", "mfa_secret", "recovery_code", "session", "device" FROM hms_app;
  END IF;
END
$$;
