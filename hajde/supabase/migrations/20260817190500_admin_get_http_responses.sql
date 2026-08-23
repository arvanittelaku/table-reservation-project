-- Admin-only helper to inspect pg_net edge function responses (debug/monitoring).
CREATE OR REPLACE FUNCTION public.admin_get_http_responses(p_limit int DEFAULT 10)
RETURNS TABLE(id bigint, status_code int, content text, created timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, net
AS $$
  SELECT r.id, r.status_code, r.content::text, r.created
  FROM net._http_response r
  ORDER BY r.id DESC
  LIMIT greatest(1, least(p_limit, 50));
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_http_responses(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_http_responses(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
