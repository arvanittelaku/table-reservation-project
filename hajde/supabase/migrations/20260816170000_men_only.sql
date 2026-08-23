-- Add men-only table restriction (parallel to women_only)

ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS men_only boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
