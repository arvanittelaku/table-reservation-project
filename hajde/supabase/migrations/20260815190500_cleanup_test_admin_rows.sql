-- OPTIONAL: remove obvious verification/test rows from live admin panel.
-- Review before running — only deletes rows matching test patterns.

-- Test reports from verify-admin-tests scripts
DELETE FROM public.reports
WHERE reason IN ('Test admin flow', 'Test dismiss flow')
   OR reason LIKE 'Test %';

-- Bans tied to deleted test reports / test reasons (adjust if you need to keep any)
DELETE FROM public.bans
WHERE reason IN ('Test admin flow', 'Test dismiss flow')
   OR reason LIKE 'Test %';

-- Test auth users (emails from automated signup) — cascades profiles/reports via FK
-- Uncomment only if you want to purge all @test.local accounts:
-- DELETE FROM auth.users WHERE email LIKE '%@test.local';
