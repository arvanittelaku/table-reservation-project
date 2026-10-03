-- Django backend: what the database needs once Django (not Supabase's API,
-- Auth, Storage, Realtime and Edge Functions) serves the app.
--
--   backend.refresh_tokens / backend.auth_tokens  login sessions + email links
--   backend.jobs                                  work Django runs (emails,
--                                                 account deletion) instead of
--                                                 the database calling HTTP
--   backend.storage_objects                       uploaded files (avatars)
--   realtime triggers                             row changes -> NOTIFY ->
--                                                 Django Channels websockets
--
-- Accounts stay in auth.users (same ids, emails and bcrypt password hashes),
-- so existing users keep logging in and every SQL function keeps working.
-- Idempotent. Not exposed to the app's roles.

CREATE SCHEMA IF NOT EXISTS backend;
REVOKE ALL ON SCHEMA backend FROM PUBLIC;

-- ───────────── sessions and one-time email links ─────────────
CREATE TABLE IF NOT EXISTS backend.refresh_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON backend.refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS backend.auth_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('signup', 'recovery')),
  redirect_to text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON backend.auth_tokens (user_id, kind);

-- ───────────── job queue ─────────────
CREATE TABLE IF NOT EXISTS backend.jobs (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  run_after   timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending ON backend.jobs (run_after) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION backend.jobs_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('backend_jobs', NEW.id::text);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_jobs_notify ON backend.jobs;
CREATE TRIGGER trg_jobs_notify AFTER INSERT ON backend.jobs FOR EACH ROW EXECUTE FUNCTION backend.jobs_notify();

-- Old SQL functions (ban_user, email_on_request, admin_delete_user,
-- admin_delete_immediately) called Supabase Edge Functions with
-- net.http_post(url := '.../functions/v1/<name>', ...). Same signature, but it
-- queues a job named after the function; Django runs it.
CREATE OR REPLACE FUNCTION public._backend_http_post(
  url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds int DEFAULT 5000
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO backend.jobs (kind, payload)
  VALUES (regexp_replace(split_part(url, '?', 1), '^.*/', ''), COALESCE(body, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._backend_http_post(text, jsonb, jsonb, jsonb, int) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE r record; def text;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc ILIKE '%net.http_post(%' AND p.proname <> '_backend_http_post'
  LOOP
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, 'net\.http_post\(', 'public._backend_http_post(', 'gi');
    EXECUTE def;
  END LOOP;
END $$;

-- ───────────── storage metadata (files live on the backend's storage) ─────────────
CREATE TABLE IF NOT EXISTS backend.storage_objects (
  bucket       text NOT NULL,
  path         text NOT NULL,
  owner        uuid,
  size         bigint NOT NULL DEFAULT 0,
  content_type text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, path)
);

-- ───────────── realtime: row changes -> NOTIFY 'realtime' ─────────────
-- Every table in the supabase_realtime publication gets this trigger, so the
-- set of live tables stays defined in one place (the publication). Rows over
-- the NOTIFY size limit are sent as their primary key and re-read by Django.
CREATE OR REPLACE FUNCTION backend.realtime_notify() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload jsonb;
  txt text;
BEGIN
  payload := jsonb_build_object(
    'schema', TG_TABLE_SCHEMA,
    'table', TG_TABLE_NAME,
    'type', TG_OP,
    'commit_timestamp', now(),
    'record', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    'old_record', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END
  );
  txt := payload::text;
  IF octet_length(txt) > 7800 THEN
    payload := payload || jsonb_build_object(
      'record', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object('id', to_jsonb(NEW) -> 'id') END,
      'old_record', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('id', to_jsonb(OLD) -> 'id') END,
      'truncated', true);
    txt := payload::text;
  END IF;
  PERFORM pg_notify('realtime', txt);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION backend.install_realtime_triggers() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_realtime_notify ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format('CREATE TRIGGER trg_realtime_notify AFTER INSERT OR UPDATE OR DELETE ON %I.%I
                    FOR EACH ROW EXECUTE FUNCTION backend.realtime_notify()', r.schemaname, r.tablename);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

SELECT backend.install_realtime_triggers();
