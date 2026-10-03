import { sb } from '../../backendClient'

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args)
  if (error) {
    const e = new Error(error.message || String(error))
    e.code = error.code
    throw e
  }
  return data
}

export const adminApi = {
  dashboard: (range) => rpc('admin_get_dashboard', { p_range: range }),

  listUsers: ({ search, status, sort, limit, offset }) =>
    rpc('admin_list_users', {
      p_search: search || null,
      p_status: status || 'all',
      p_sort: sort || 'newest',
      p_limit: limit,
      p_offset: offset,
    }),
  getUser: (id) => rpc('admin_get_user', { p_user: id }),

  listTables: ({ search, status, kind, city, sort, limit, offset }) =>
    rpc('admin_list_tables', {
      p_search: search || null,
      p_status: status || 'all',
      p_kind: kind || null,
      p_city: city || null,
      p_sort: sort || 'newest',
      p_limit: limit,
      p_offset: offset,
    }),
  getTable: (id) => rpc('admin_get_table', { p_table: id }),

  listPayments: ({ search, status, provider, from, to, limit, offset }) =>
    rpc('admin_list_payments', {
      p_search: search || null,
      p_status: status || null,
      p_provider: provider || null,
      p_from: from || null,
      p_to: to || null,
      p_limit: limit,
      p_offset: offset,
    }),

  listReports: (status) => rpc('admin_list_reports', { p_status: status }),
  listBans: () => rpc('admin_list_bans'),
  listWednesday: () => rpc('admin_list_wednesday'),
  plansOverview: () => rpc('admin_plans_overview'),
  markOrderPaid: (id) => rpc('admin_mark_order_paid', { p_order: id }),
  cancelOrder: (id) => rpc('admin_cancel_order', { p_order: id }),
  grantPremium: (userId, planId, note) => rpc('admin_grant_premium', { p_user: userId, p_plan: planId, p_note: note || null }),
  revokePremium: (userId, reason) => rpc('admin_revoke_premium', { p_user: userId, p_reason: reason }),
  updatePlan: (id, { priceCents, tableLimit, joinLimit, active }) =>
    rpc('admin_update_plan', { p_plan: id, p_price_cents: priceCents, p_table_limit: tableLimit, p_join_limit: joinLimit, p_active: active }),
  wednesdaySignups: () => rpc('admin_wednesday_signups'),
  formWednesday: (dinner) => rpc('admin_form_wednesday', { p_dinner: dinner || null }),
  listTutors: (status) => rpc('admin_list_tutors', { p_status: status }),
  reviewTutor: (id, status, reason) => rpc('admin_review_tutor', { p_user: id, p_status: status, p_reason: reason || null }),
  listAudit: ({ limit, offset }) => rpc('admin_list_audit', { p_limit: limit, p_offset: offset }),
  search: (q) => rpc('admin_global_search', { p_q: q }),

  // actions
  banUser: (id, reason) => rpc('admin_ban_user', { p_user: id, p_reason: reason }),
  setDeactivated: (id, deactivated, reason) =>
    rpc('admin_set_user_deactivated', { p_user: id, p_deactivated: deactivated, p_reason: reason || null }),
  setAdmin: (id, isAdmin) => rpc('admin_set_user_admin', { p_user: id, p_is_admin: isAdmin }),
  deleteUser: (id, reason) => rpc('admin_delete_user', { p_user: id, p_reason: reason }),
  notifyUser: (id, message) => rpc('admin_notify_user', { p_user: id, p_message: message }),
  cancelTable: (id, reason) => rpc('admin_cancel_table', { p_table: id, p_reason: reason }),
  restoreTable: (id) => rpc('admin_restore_table', { p_table: id }),
  dismissReport: (id) => rpc('admin_dismiss_report', { p_report_id: id }),
  banFromReport: (id, reason) => rpc('admin_ban_from_report', { p_report_id: id, p_reason: reason }),
  deleteFromReport: (id, reason) => rpc('admin_delete_immediately', { p_report_id: id, p_reason: reason }),
  setRestaurantActive: (id, active) =>
    rpc('admin_set_restaurant_active', { p_restaurant: id, p_active: active }),
  upsertRestaurant: ({ id, name, city, address, maps_link }) =>
    rpc('admin_upsert_restaurant', {
      p_id: id || null,
      p_name: name,
      p_city: city,
      p_address: address,
      p_maps_link: maps_link || null,
    }),
}

/** True when the backend is missing the v2 RPCs (migration not applied yet). */
export function isMissingRpc(err) {
  const m = String(err?.message || '')
  return err?.code === 'PGRST202' || /Could not find the function/i.test(m)
}
