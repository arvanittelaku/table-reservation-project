-- Fix ban_user pg_net auth: read service role key from vault (app_service_key),
-- with fallback to legacy app.service_key database setting.

CREATE OR REPLACE FUNCTION public.ban_user(p_user uuid, p_reason text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ban_count int;
  v_service_key text;
BEGIN
  SELECT decrypted_secret
    INTO v_service_key
    FROM vault.decrypted_secrets
   WHERE name = 'app_service_key'
   LIMIT 1;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    v_service_key := current_setting('app.service_key', true);
  END IF;

  INSERT INTO public.bans (user_id, reason) VALUES (p_user, p_reason);
  SELECT count(*) INTO v_ban_count FROM public.bans WHERE user_id = p_user;

  INSERT INTO public.notifications (user_id, icon, body)
  VALUES (
    p_user,
    'warning',
    'Llogaria juaj u pezullua. Arsyeja: ' || p_reason ||
    '. Pezullim ' || v_ban_count || '/3.'
  );

  PERFORM net.http_post(
    url := 'https://upxxfhvgbmddhyebaiug.supabase.co/functions/v1/notify-ban',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'user_id', p_user,
      'reason', p_reason,
      'ban_count', v_ban_count
    )
  );

  IF v_ban_count >= 3 THEN
    PERFORM net.http_post(
      url := 'https://upxxfhvgbmddhyebaiug.supabase.co/functions/v1/delete-banned-user',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('user_id', p_user)
    );
  END IF;

  RETURN v_ban_count;
END;
$$;

NOTIFY pgrst, 'reload schema';
