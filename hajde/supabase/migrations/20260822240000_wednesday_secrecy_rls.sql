-- Close Wednesday Dinner pre-reveal bypass: gate restaurant identity at DB level, not only in RPC.

-- 1) Remove member direct read of wednesday_groups (exposed restaurant_id pre-reveal)
DROP POLICY IF EXISTS wg_select_member ON public.wednesday_groups;

-- Admins may inspect groups for support; regular users use RPCs only.
DROP POLICY IF EXISTS wg_select_admin ON public.wednesday_groups;
CREATE POLICY wg_select_admin ON public.wednesday_groups
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

-- 2) Restaurant pool readable by admins only (never browsable by regular users)
DROP POLICY IF EXISTS wr_select_admin ON public.wednesday_restaurants;
CREATE POLICY wr_select_admin ON public.wednesday_restaurants
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

-- 3) Safe member metadata without restaurant_id (replaces direct group reads / embeds)
CREATE OR REPLACE FUNCTION public.get_my_wednesday_groups()
RETURNS TABLE(group_id uuid, city text, dinner_date timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.id, g.city, g.dinner_date
  FROM public.wednesday_groups g
  INNER JOIN public.wednesday_participants wp ON wp.group_id = g.id
  WHERE wp.user_id = auth.uid()
  ORDER BY g.dinner_date ASC;
$$;

REVOKE ALL ON FUNCTION public.get_my_wednesday_groups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_wednesday_groups() TO authenticated;

NOTIFY pgrst, 'reload schema';
