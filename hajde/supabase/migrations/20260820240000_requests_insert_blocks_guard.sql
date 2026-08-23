-- Defense in depth: block direct requests.insert() when either party blocked the other

DROP POLICY IF EXISTS requests_insert ON public.requests;
CREATE POLICY requests_insert ON public.requests
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tables t
      WHERE t.id = table_id
        AND t.event_datetime > now()
        AND t.status = 'open'
        AND NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE (b.blocker_id = auth.uid() AND b.blocked_id = t.host_id)
             OR (b.blocker_id = t.host_id AND b.blocked_id = auth.uid())
        )
    )
  );

NOTIFY pgrst, 'reload schema';
