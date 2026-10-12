import { sb } from '../../backendClient'
import type { TableKind, TutorStatus, Uuid } from '../../types/db'
import type {
  AdminBanGroup, AdminPaymentList, AdminReportRow, AdminTableDetail, AdminTableList, AdminTutor, AdminUserDetail,
  AdminUserListRow, AdminWednesday, AdminWednesdaySignup, AuditRow, Dashboard, DashboardRange, GlobalSearch, Page,
  PlansOverview, PlanUpdate, ReportStatusFilter, RestaurantInput, TableStatusFilter, TutorStatusFilter,
  UserStatusFilter, WednesdayFormResult,
} from './adminTypes'

/** Error thrown by admin calls; `code` is the backend/PostgREST error code. */
export class AdminError extends Error {
  code?: string
  constructor(message: string, code?: string) { super(message); this.code = code }
}

async function rpc<T = null>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc<T>(name, args)
  if (error) throw new AdminError(error.message || String(error), error.code)
  return data as T
}

export interface ListArgs { limit: number; offset: number }
export interface UserListArgs extends ListArgs { search?: string; status?: UserStatusFilter; sort?: string }
export interface TableListArgs extends ListArgs { search?: string; status?: TableStatusFilter; kind?: TableKind | ''; city?: string; sort?: string }
export interface PaymentListArgs extends ListArgs { search?: string; status?: string; provider?: string; from?: string | null; to?: string | null }

export const adminApi = {
  dashboard: (range: DashboardRange) => rpc<Dashboard>('admin_get_dashboard', { p_range: range }),

  listUsers: ({ search, status, sort, limit, offset }: UserListArgs) =>
    rpc<Page<AdminUserListRow>>('admin_list_users', {
      p_search: search || null,
      p_status: status || 'all',
      p_sort: sort || 'newest',
      p_limit: limit,
      p_offset: offset,
    }),
  getUser: (id: Uuid) => rpc<AdminUserDetail>('admin_get_user', { p_user: id }),

  listTables: ({ search, status, kind, city, sort, limit, offset }: TableListArgs) =>
    rpc<AdminTableList>('admin_list_tables', {
      p_search: search || null,
      p_status: status || 'all',
      p_kind: kind || null,
      p_city: city || null,
      p_sort: sort || 'newest',
      p_limit: limit,
      p_offset: offset,
    }),
  getTable: (id: Uuid) => rpc<AdminTableDetail>('admin_get_table', { p_table: id }),

  listPayments: ({ search, status, provider, from, to, limit, offset }: PaymentListArgs) =>
    rpc<AdminPaymentList>('admin_list_payments', {
      p_search: search || null,
      p_status: status || null,
      p_provider: provider || null,
      p_from: from || null,
      p_to: to || null,
      p_limit: limit,
      p_offset: offset,
    }),

  listReports: (status: ReportStatusFilter) => rpc<AdminReportRow[]>('admin_list_reports', { p_status: status }),
  listBans: () => rpc<AdminBanGroup[]>('admin_list_bans'),
  listWednesday: () => rpc<AdminWednesday>('admin_list_wednesday'),
  plansOverview: () => rpc<PlansOverview>('admin_plans_overview'),
  markOrderPaid: (id: Uuid) => rpc<Uuid>('admin_mark_order_paid', { p_order: id }),
  cancelOrder: (id: Uuid) => rpc('admin_cancel_order', { p_order: id }),
  grantPremium: (userId: Uuid, planId: string, note?: string | null) => rpc<Uuid>('admin_grant_premium', { p_user: userId, p_plan: planId, p_note: note || null }),
  revokePremium: (userId: Uuid, reason: string) => rpc<number>('admin_revoke_premium', { p_user: userId, p_reason: reason }),
  updatePlan: (id: string, { priceCents, tableLimit, joinLimit, active }: PlanUpdate) =>
    rpc('admin_update_plan', { p_plan: id, p_price_cents: priceCents, p_table_limit: tableLimit, p_join_limit: joinLimit, p_active: active }),
  wednesdaySignups: () => rpc<AdminWednesdaySignup[]>('admin_wednesday_signups'),
  formWednesday: (dinner?: string | null) => rpc<WednesdayFormResult>('admin_form_wednesday', { p_dinner: dinner || null }),
  listTutors: (status: TutorStatusFilter) => rpc<AdminTutor[]>('admin_list_tutors', { p_status: status }),
  reviewTutor: (id: Uuid, status: TutorStatus, reason?: string | null) => rpc('admin_review_tutor', { p_user: id, p_status: status, p_reason: reason || null }),
  listAudit: ({ limit, offset }: ListArgs) => rpc<Page<AuditRow>>('admin_list_audit', { p_limit: limit, p_offset: offset }),
  search: (q: string) => rpc<GlobalSearch>('admin_global_search', { p_q: q }),

  // actions
  banUser: (id: Uuid, reason: string) => rpc<number>('admin_ban_user', { p_user: id, p_reason: reason }),
  setDeactivated: (id: Uuid, deactivated: boolean, reason?: string | null) =>
    rpc('admin_set_user_deactivated', { p_user: id, p_deactivated: deactivated, p_reason: reason || null }),
  setAdmin: (id: Uuid, isAdmin: boolean) => rpc('admin_set_user_admin', { p_user: id, p_is_admin: isAdmin }),
  deleteUser: (id: Uuid, reason: string) => rpc('admin_delete_user', { p_user: id, p_reason: reason }),
  notifyUser: (id: Uuid, message: string) => rpc('admin_notify_user', { p_user: id, p_message: message }),
  cancelTable: (id: Uuid, reason: string) => rpc<number>('admin_cancel_table', { p_table: id, p_reason: reason }),
  restoreTable: (id: Uuid) => rpc('admin_restore_table', { p_table: id }),
  dismissReport: (id: Uuid) => rpc('admin_dismiss_report', { p_report_id: id }),
  banFromReport: (id: Uuid, reason: string) => rpc<number>('admin_ban_from_report', { p_report_id: id, p_reason: reason }),
  deleteFromReport: (id: Uuid, reason: string) => rpc('admin_delete_immediately', { p_report_id: id, p_reason: reason }),
  setRestaurantActive: (id: Uuid, active: boolean) =>
    rpc('admin_set_restaurant_active', { p_restaurant: id, p_active: active }),
  upsertRestaurant: ({ id, name, city, address, maps_link }: RestaurantInput) =>
    rpc<Uuid>('admin_upsert_restaurant', {
      p_id: id || null,
      p_name: name,
      p_city: city,
      p_address: address,
      p_maps_link: maps_link || null,
    }),
}

/** True when the backend is missing the v2 RPCs (migration not applied yet). */
export function isMissingRpc(err: unknown): boolean {
  const e = err as { message?: unknown; code?: unknown } | null | undefined
  const m = String(e?.message || '')
  return e?.code === 'PGRST202' || /Could not find the function/i.test(m)
}
