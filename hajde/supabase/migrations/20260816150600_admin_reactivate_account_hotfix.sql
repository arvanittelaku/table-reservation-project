-- Hotfix: ensure admin_reactivate_account is exposed to PostgREST (schema cache reload)

DROP FUNCTION IF EXISTS public.admin_reactivate_account(uuid);

CREATE OR REPLACE FUNCTION public.admin_reactivate_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Vetëm adminët mund ta bëjnë këtë';
  END IF;
  UPDATE public.profiles SET deactivated_at = NULL WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.admin_reactivate_account(uuid)
  IS 'Admin-only: clear profiles.deactivated_at for support reactivations';

REVOKE ALL ON FUNCTION public.admin_reactivate_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reactivate_account(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_account(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
