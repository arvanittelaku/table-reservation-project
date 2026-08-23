  -- Admin-only path to reactivate a deactivated account (support / accidental deactivation)

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

  REVOKE EXECUTE ON FUNCTION public.admin_reactivate_account(uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.admin_reactivate_account(uuid) TO authenticated;

  NOTIFY pgrst, 'reload schema';
