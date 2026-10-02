-- Allow immediate revocation of already-issued access tokens after logout,
-- password reset, account security events, or refresh-token reuse.
ALTER TABLE "users"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
