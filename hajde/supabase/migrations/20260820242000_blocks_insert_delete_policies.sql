-- Restore block write policies (blocks_own was SELECT-only after bidirectional read fix)

DROP POLICY IF EXISTS blocks_insert_own ON public.blocks;
CREATE POLICY blocks_insert_own ON public.blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS blocks_delete_own ON public.blocks;
CREATE POLICY blocks_delete_own ON public.blocks
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

NOTIFY pgrst, 'reload schema';
