-- Fix join-request email trigger: production URL + vault service key (matches ban_user).

CREATE OR REPLACE FUNCTION public.email_on_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_host uuid;
  v_title text;
  v_name text;
  v_service_key text;
BEGIN
  SELECT host_id, title INTO v_host, v_title FROM public.tables WHERE id = NEW.table_id;
  SELECT first_name || ' ' || last_name INTO v_name FROM public.profiles WHERE id = NEW.user_id;

  SELECT decrypted_secret
    INTO v_service_key
    FROM vault.decrypted_secrets
   WHERE name = 'app_service_key'
   LIMIT 1;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    v_service_key := current_setting('app.service_key', true);
  END IF;

  PERFORM net.http_post(
    url := 'https://upxxfhvgbmddhyebaiug.supabase.co/functions/v1/notify-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'host_id', v_host,
      'requester_name', v_name,
      'table_title', v_title
    )
  );
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
