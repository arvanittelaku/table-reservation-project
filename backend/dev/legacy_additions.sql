-- Tables added after the SQL implementation (no legacy counterpart), so the
-- Python side of dev/difftest.py can run on ejb_legacy. Mirrors the Django
-- migrations; empty, so the SQL side behaves exactly as before.
-- 0005_official_events
CREATE TABLE IF NOT EXISTS public.official_events (
  table_id uuid PRIMARY KEY REFERENCES public.tables(id) ON DELETE CASCADE,
  premium_hours integer NOT NULL DEFAULT 48
    CONSTRAINT official_events_premium_hours_check CHECK (premium_hours >= 0 AND premium_hours <= 720),
  marked_by_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.official_events ENABLE ROW LEVEL SECURITY;
