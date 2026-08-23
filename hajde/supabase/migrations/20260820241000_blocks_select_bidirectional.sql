-- Allow both parties in a block to read the row (needed for bidirectional tables_select RLS)

DROP POLICY IF EXISTS blocks_own ON public.blocks;
CREATE POLICY blocks_own ON public.blocks
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid() OR blocked_id = auth.uid());

NOTIFY pgrst, 'reload schema';
