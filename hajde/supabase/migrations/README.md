# Superseded

These SQL migrations are the history of the old Supabase backend. The database
is now managed by Django (`backend/ejb/migrations/`); all app logic (functions,
triggers, access policies) lives in Python. Do not apply these files to
production: `backend/README.md` → "Switching production" has the steps.
They are still used locally to build the legacy reference database for
`backend/dev/difftest.py`.
