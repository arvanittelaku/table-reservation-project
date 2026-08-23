-- Permanent account deactivation: users cannot self-reactivate (admin override only)

CREATE OR REPLACE FUNCTION public.prevent_reactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.deactivated_at IS NOT NULL AND NEW.deactivated_at IS NULL THEN
    IF NOT public.is_admin_user() THEN
      RAISE EXCEPTION 'Llogaritë e çaktivizuara nuk mund të riaktivizohen';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_reactivation ON public.profiles;
CREATE TRIGGER trg_prevent_reactivation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_reactivation();

NOTIFY pgrst, 'reload schema';
