import { QueryClient } from '@tanstack/react-query'

/**
 * One client for the app. Server state is kept fresh by realtime events
 * (hooks invalidate their query when one arrives), so queries do not refetch on
 * window focus or on every mount; a failed read is retried once.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
})

/** Query keys, in one place so realtime handlers and mutations invalidate the right data. */
export const queryKeys = {
  tables: (city: string | null | undefined, category: string | null | undefined, userId: string | null) =>
    ['tables', city ?? null, category ?? null, userId] as const,
  allTables: ['tables'] as const,
  plan: (userId: string) => ['plan', userId] as const,
  profile: (userId: string) => ['profile', userId] as const,
  notifications: (userId: string) => ['notifications', userId] as const,
}
