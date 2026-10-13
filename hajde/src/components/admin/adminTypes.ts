/**
 * Results of the admin_* RPCs (backend/ejb/services/admin_views.py, admin_actions.py,
 * plans.py, wednesday.py, lessons.py). UUIDs and timestamps are strings.
 */
import type {
  Json, LessonFormat, PaymentStatus, PlanRow, PlanTier, ReportStatus, RequestStatus, SubscriptionRow,
  TableKind, TableRow, TableStatus, Timestamp, TutorRow, TutorStatus, Uuid, WednesdaySignupStatus, OrderStatus,
  MembershipRole,
} from '../../types/db'

export type { LessonFormat }
export type DashboardRange = 'day' | 'month' | 'year'

export interface SeriesPoint { period: Timestamp; count: number }

export interface DashboardTotals {
  users_total: number; users_today: number; users_7d: number; users_30d: number
  users_deactivated: number; users_unconfirmed: number; users_active_7d: number; admins: number
  tables_total: number; tables_upcoming: number; tables_today: number; tables_cancelled: number
  seats_taken: number; requests_pending: number; requests_awaiting_payment: number
  payments_count: number; revenue_total_cents: number; revenue_today_cents: number; revenue_30d_cents: number
  payments_stub: number; reports_pending: number; reports_total: number; bans_total: number; banned_users: number
  wednesday_upcoming: number; wednesday_participants: number
}

export interface Dashboard {
  range: DashboardRange
  generated_at: Timestamp
  totals: DashboardTotals
  series: { new_users: SeriesPoint[]; tables_opened: SeriesPoint[]; seats_taken: SeriesPoint[]; revenue: SeriesPoint[] }
  by_city: Array<{ city: string; tables: number }>
  by_kind: Array<{ kind: TableKind; tables: number }>
  recent_users: Array<{ id: Uuid; first_name: string; last_name: string; photo_path: string | null; created_at: Timestamp; email: string | null }>
  upcoming_tables: Array<{ id: Uuid; title: string; city: string; kind: TableKind; event_datetime: Timestamp; spots: number; status: TableStatus; seated: number }>
  recent_payments: Array<{
    id: Uuid; amount_cents: number; currency: string; status: PaymentStatus; provider: string; ticket_code: string | null
    created_at: Timestamp; user_id: Uuid | null; table_id: Uuid | null; payer_name: string | null; table_title: string | null
  }>
}

export interface Page<Row> { total: number; rows: Row[] }

export type UserStatusFilter = 'all' | 'active' | 'deactivated' | 'admin' | 'banned' | 'reported' | 'unconfirmed' | 'paying' | 'hosts'
export interface AdminUserListRow {
  id: Uuid; first_name: string; last_name: string; age: number; photo_path: string | null; is_tourist: boolean
  from_place: string | null; verified: boolean; rating: number; is_admin: boolean; deactivated_at: Timestamp | null
  created_at: Timestamp; email: string | null; last_sign_in_at: Timestamp | null; email_confirmed_at: Timestamp | null
  hosted_count: number; joined_count: number; payments_count: number; paid_cents: number; bans_count: number
  reports_against: number; reports_pending: number; blocked_by_count: number
}

export interface AuditEntry { id: number; action: string; admin_name: string | null; details: Record<string, Json> | null; created_at: Timestamp }

export interface AdminUserDetail {
  profile: {
    id: Uuid; first_name: string; last_name: string; age: number; photo_path: string | null; photo_face_ok: boolean
    is_tourist: boolean; from_place: string | null; langs: string[]; verified: boolean; rating: number; is_admin: boolean
    deactivated_at: Timestamp | null; created_at: Timestamp; email: string | null; last_sign_in_at: Timestamp | null
    email_confirmed_at: Timestamp | null; auth_created_at: Timestamp | null
  }
  counts: {
    hosted: number; joined: number; requests: number; payments: number; paid_cents: number; messages: number
    ratings_given: number; connections: number; blocked_by: number; blocking: number; reports_against: number
    reports_made: number; bans: number
  }
  hosted_tables: Array<{ id: Uuid; title: string; kind: TableKind; city: string; status: TableStatus; event_datetime: Timestamp; spots: number; created_at: Timestamp; guests: number }>
  joined_tables: Array<{
    id: Uuid; title: string; kind: TableKind; city: string; status: TableStatus; event_datetime: Timestamp; joined_at: Timestamp
    host_name: string | null; amount_cents: number | null; ticket_code: string | null; payment_status: PaymentStatus | null
  }>
  requests: Array<{ id: Uuid; status: RequestStatus; created_at: Timestamp; table_id: Uuid; table_title: string; event_datetime: Timestamp }>
  payments: Array<{
    id: Uuid; amount_cents: number; currency: string; status: PaymentStatus; provider: string; provider_ref: string | null
    ticket_code: string | null; created_at: Timestamp; table_id: Uuid | null; table_title: string | null
  }>
  reports_against: Array<{ id: Uuid; reason: string; details: string | null; status: ReportStatus; created_at: Timestamp; reporter_id: Uuid; reporter_name: string | null; table_title: string | null }>
  reports_made: Array<{ id: Uuid; reason: string; status: ReportStatus; created_at: Timestamp; reported_id: Uuid; reported_name: string | null }>
  bans: Array<{ id: Uuid; reason: string; created_at: Timestamp }>
  audit: AuditEntry[]
}

export type TableStatusFilter = 'all' | 'upcoming' | 'past' | 'full' | 'cancelled' | 'reported' | 'paid' | 'official'

/** official_events row: an event hosted by the team with a Premium-first window. */
export interface OfficialEventRow { table_id: Uuid; premium_hours: number }
export interface AdminTableListRow extends Pick<TableRow,
  'id' | 'title' | 'kind' | 'category' | 'city' | 'to_city' | 'area' | 'time_label' | 'event_datetime' | 'created_at'
  | 'status' | 'spots' | 'women_only' | 'men_only' | 'mystery' | 'maps_link' | 'host_id'> {
  host_name: string | null; host_photo_path: string | null; is_past: boolean; guests: number; seated: number
  pending_requests: number; awaiting_payment: number; waitlist_count: number; paid_count: number
  revenue_cents: number; messages_count: number; reports_count: number
}
export interface AdminTableList extends Page<AdminTableListRow> { cities: string[] }

export interface AdminTableDetail {
  table: TableRow & { host_name: string | null; host_photo_path: string | null; host_email: string | null; is_past: boolean }
  members: Array<{
    user_id: Uuid; role: MembershipRole; joined_at: Timestamp; first_name: string; last_name: string; photo_path: string | null
    age: number; email: string | null; payment_id: Uuid | null; amount_cents: number | null; payment_status: PaymentStatus | null
    ticket_code: string | null; provider: string | null; paid_at: Timestamp | null
  }>
  requests: Array<{ id: Uuid; user_id: Uuid; status: RequestStatus; created_at: Timestamp; first_name: string; last_name: string; photo_path: string | null; age: number }>
  waitlist: Array<{ user_id: Uuid; created_at: Timestamp; first_name: string; last_name: string }>
  payments: Array<{
    id: Uuid; user_id: Uuid | null; amount_cents: number; currency: string; status: PaymentStatus; provider: string
    provider_ref: string | null; ticket_code: string | null; created_at: Timestamp; payer_name: string | null
  }>
  reports: Array<{ id: Uuid; reason: string; status: ReportStatus; created_at: Timestamp; reporter_name: string | null; reported_name: string | null; reported_id: Uuid }>
  chat: { messages: number; last_message_at: Timestamp | null }
  audit: AuditEntry[]
}

export interface AdminPaymentRow {
  id: Uuid; user_id: Uuid | null; table_id: Uuid | null; amount_cents: number; currency: string; provider: string
  provider_ref: string | null; status: PaymentStatus; ticket_code: string | null; refundable: boolean; created_at: Timestamp
  payer_name: string | null; payer_email: string | null; table_title: string | null; table_city: string | null
  table_event_datetime: Timestamp | null; host_name: string | null
}
export interface AdminPaymentList extends Page<AdminPaymentRow> { sum_paid_cents: number; count_paid: number; providers: string[] }

export type ReportStatusFilter = ReportStatus | 'all'
export interface AdminReportRow {
  id: Uuid; reason: string; details: string | null; status: ReportStatus; created_at: Timestamp; reviewed_at: Timestamp | null
  reporter_id: Uuid; reporter_name: string | null; reporter_photo_path: string | null
  reported_id: Uuid; reported_name: string | null; reported_photo_path: string | null; reported_is_admin: boolean | null
  table_id: Uuid | null; table_title: string | null; reviewed_by_name: string | null
  reported_total_reports: number; reported_bans: number
}

export interface AdminBanGroup {
  user_id: Uuid; name: string | null; photo_path: string | null; deactivated_at: Timestamp | null; email: string | null
  ban_count: number; last_ban_at: Timestamp; last_reason: string
  history: Array<{ id: Uuid; reason: string; created_at: Timestamp }>
}

export interface WednesdayParticipant { user_id: Uuid; first_name: string; last_name: string; photo_path: string | null; age: number }
export interface AdminWednesdayGroup {
  id: Uuid; city: string; dinner_date: Timestamp; created_at: Timestamp; restaurant_id: Uuid | null
  restaurant_name: string | null; restaurant_address: string | null; revealed: boolean; participants: WednesdayParticipant[]
}
export interface AdminRestaurant { id: Uuid; name: string; city: string; address: string; maps_link: string | null; active: boolean; times_used: number }
export interface AdminWednesday { groups: AdminWednesdayGroup[]; restaurants: AdminRestaurant[] }
export interface AdminWednesdaySignup {
  user_id: Uuid; dinner_date: Timestamp; city: string; status: WednesdaySignupStatus; created_at: Timestamp; group_id: Uuid | null
  is_premium: boolean; first_name: string; last_name: string; photo_path: string | null; age: number
}
export interface WednesdayFormResult { groups: number; grouped: number; waitlisted: number; dinner_date?: Timestamp }
export interface RestaurantInput { id?: Uuid | null; name: string; city: string; address: string; maps_link?: string | null }

export interface AdminOrder {
  id: Uuid; code: string; plan_id: string; amount_cents: number; status: OrderStatus; created_at: Timestamp
  handled_at: Timestamp | null; user_id: Uuid; name: string | null; photo_path: string | null; email: string | null
}
export interface AdminSubscription extends Pick<SubscriptionRow, 'id' | 'plan_id' | 'starts_at' | 'ends_at' | 'status' | 'source' | 'amount_cents' | 'note' | 'created_at' | 'user_id'> {
  name: string | null; photo_path: string | null; current: boolean
}
export interface PlansOverview {
  plans: PlanRow[] | null
  active_premium: number; revenue_30d_cents: number; revenue_total_cents: number; expiring_7d: number
  orders: AdminOrder[]; subscriptions: AdminSubscription[]
}
export interface PlanUpdate { priceCents: number | null; tableLimit: number | null; joinLimit: number | null; active: boolean | null }
export type { PlanTier }

export type TutorStatusFilter = TutorStatus | 'all'
export interface AdminTutor extends TutorRow {
  first_name: string; last_name: string; photo_path: string | null; age: number; email: string | null
  reviewed_by_name: string | null; lessons_count: number; reports_against: number
}

export interface AuditRow {
  id: number; admin_id: Uuid | null; admin_name: string | null; action: string; target_type: string | null
  target_id: Uuid | null; target_label: string | null; details: Record<string, Json> | null; created_at: Timestamp
}

export interface GlobalSearch {
  users: Array<{ id: Uuid; first_name: string; last_name: string; photo_path: string | null; email: string | null; deactivated_at: Timestamp | null; is_admin: boolean }>
  tables: Array<{ id: Uuid; title: string; city: string; kind: TableKind; status: TableStatus; event_datetime: Timestamp }>
  payments: Array<{ id: Uuid; ticket_code: string | null; amount_cents: number; status: PaymentStatus; created_at: Timestamp; user_id: Uuid | null; table_id: Uuid | null; payer_name: string | null }>
}
