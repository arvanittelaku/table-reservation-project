/*
 * OFFLINE-ONLY type shim for '@tanstack/react-query', 'react-router' and CSS imports.
 * These packages ship their own types (and vite/client declares *.css), but they are not
 * installed in the sandbox the migration was done in. Only the API the app uses is declared,
 * with the packages' real signatures (simplified). Used only by tsconfig.offline.json;
 * delete with react-shim.d.ts once `npm install` has run (see TYPESCRIPT.md).
 */

declare module '*.css' {}

declare module '@tanstack/react-query' {
  import type { FunctionComponent, ReactNode } from 'react'
  export type QueryKey = readonly unknown[]
  export type QueryStatus = 'pending' | 'error' | 'success'
  export interface QueryOptions<TData, TKey extends QueryKey = QueryKey> {
    queryKey: TKey
    queryFn: () => Promise<TData> | TData
    enabled?: boolean
    staleTime?: number
    gcTime?: number
    retry?: boolean | number
    refetchOnWindowFocus?: boolean
    refetchOnReconnect?: boolean
  }
  export interface QueryObserverResult<TData, TError = Error> {
    data: TData | undefined
    error: TError | null
    status: QueryStatus
    isPending: boolean
    isLoading: boolean
    isError: boolean
    isSuccess: boolean
    isFetching: boolean
    refetch: () => Promise<QueryObserverResult<TData, TError>>
  }
  export type UseQueryResult<TData, TError = Error> = QueryObserverResult<TData, TError>
  export function useQuery<TData, TKey extends QueryKey = QueryKey>(options: QueryOptions<TData, TKey>): UseQueryResult<TData>
  export type Updater<T> = T | ((old: T) => T)
  export interface QueryClientConfig {
    defaultOptions?: { queries?: Partial<Omit<QueryOptions<unknown>, 'queryKey' | 'queryFn'>> }
  }
  export class QueryClient {
    constructor(config?: QueryClientConfig)
    setQueryData<TData>(queryKey: QueryKey, updater: Updater<TData | undefined>): TData | undefined
    getQueryData<TData>(queryKey: QueryKey): TData | undefined
    fetchQuery<TData>(options: QueryOptions<TData>): Promise<TData>
    removeQueries(filters?: { queryKey?: QueryKey; exact?: boolean }): void
    invalidateQueries(filters?: { queryKey?: QueryKey; exact?: boolean }): Promise<void>
  }
  export function useQueryClient(): QueryClient
  export const QueryClientProvider: FunctionComponent<{ client: QueryClient; children?: ReactNode }>
}

declare module 'react-router' {
  import type { FunctionComponent, ReactNode } from 'react'
  export type NavigationType = 'POP' | 'PUSH' | 'REPLACE'
  export interface Location<State = unknown> { pathname: string; search: string; hash: string; state: State; key: string }
  export interface NavigateOptions { replace?: boolean; state?: unknown; preventScrollReset?: boolean }
  export interface NavigateFunction {
    (to: string, options?: NavigateOptions): void | Promise<void>
    (delta: number): void | Promise<void>
  }
  export function useLocation(): Location
  export function useNavigate(): NavigateFunction
  export function useNavigationType(): NavigationType
  export interface RouteObject { path?: string; index?: boolean; element?: ReactNode; children?: RouteObject[] }
  export interface DataRouter { navigate: NavigateFunction }
  export function createBrowserRouter(routes: RouteObject[], opts?: { basename?: string }): DataRouter
  export const RouterProvider: FunctionComponent<{ router: DataRouter }>
  export function Outlet(): ReactNode
}
