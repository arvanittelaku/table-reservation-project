/**
 * Rows as the Django backend returns them (/rest/v1/query, realtime payloads, RPCs).
 * Derived from backend/ejb/models.py: column names as in the database
 * (ForeignKey `host` -> `host_id`), UUIDs and timestamps as strings,
 * DecimalField (profiles.rating) as number, text[] as string[].
 */

export type Uuid = string
/** ISO 8601 timestamp, e.g. 2026-10-11T18:00:00+00:00 */
export type Timestamp = string
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/* ───────────── people ───────────── */

export interface ProfileRow {
  id: Uuid
  first_name: string
  last_name: string
  age: number
  photo_path: string | null
  photo_face_ok: boolean
  is_tourist: boolean
  from_place: string | null
  langs: string[]
  verified: boolean
  rating: number
  tables_hosted: number
  created_at: Timestamp
  deactivated_at: Timestamp | null
  is_admin: boolean
  user_preferences: { email_notifications?: boolean; [key: string]: Json | undefined }
  onboarded_at: Timestamp | null
  home_city: string | null
  home_city_changed_at: Timestamp | null
}

export interface TasteProfileRow {
  user_id: Uuid
  group_size: string | null
  depth: string | null
  time_pref: string | null
  energy: string | null
  interests: string[]
  field: string | null
  biz_sport: string | null
  weekend: string | null
  role: string | null
  music: string | null
  freq: string | null
  organizer: string | null
  humor: string | null
  new_people: string | null
  done: boolean
  updated_at: Timestamp
}

export interface AffinityRow { user_id: Uuid; category: string; score: number }
export interface BadgeRow { user_id: Uuid; badge_id: string; earned_at: Timestamp }
export interface BlockRow { blocker_id: Uuid; blocked_id: Uuid; created_at: Timestamp }
export interface BanRow { id: Uuid; user_id: Uuid; reason: string; created_at: Timestamp }
export interface ConnectionRow { a: Uuid; b: Uuid; created_at: Timestamp }

/* ───────────── tables ───────────── */

export type TableKind = 'tavoline' | 'vozitje' | 'udhetim' | 'darka_e_merkures' | 'sport'
export type TableStatus = 'open' | 'full' | 'done' | 'cancelled'
export type Sport = 'football' | 'basketball' | 'volleyball' | 'tennis' | 'padel' | 'table_tennis' | 'badminton' | 'running' | 'fitness'
export type SkillLevel = 'any' | 'beginner' | 'intermediate' | 'advanced'

export interface TableRow {
  id: Uuid
  host_id: Uuid
  kind: TableKind
  category: string
  title: string
  area: string | null
  city: string
  to_city: string | null
  budget: string | null
  maps_link: string | null
  time_label: string
  starts_at: Timestamp | null
  spots: number
  women_only: boolean
  mystery: boolean
  revealed: boolean
  langs: string[]
  tags: string[]
  description: string
  status: TableStatus
  created_at: Timestamp
  event_datetime: Timestamp
  men_only: boolean
  sport: Sport | null
  skill_level: SkillLevel | null
  share_code: string
  activity_at: Timestamp
}

export type MembershipRole = 'host' | 'member'
export interface MembershipRow { table_id: Uuid; user_id: Uuid; role: MembershipRole; joined_at: Timestamp }

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'confirmed' | 'expired'
export interface RequestRow { id: Uuid; table_id: Uuid; user_id: Uuid; status: RequestStatus; created_at: Timestamp }

export interface WaitlistRow { table_id: Uuid; user_id: Uuid; created_at: Timestamp }
export interface MessageRow { id: Uuid; table_id: Uuid; sender_id: Uuid; body: string; created_at: Timestamp }
export interface RatingRow { id: Uuid; table_id: Uuid; rater_id: Uuid; stars: number; meet_again: boolean; created_at: Timestamp }
export interface ConnectionPickRow { table_id: Uuid; picker_id: Uuid; picked_id: Uuid; created_at: Timestamp }

export type ReportStatus = 'pending' | 'reviewed_banned' | 'reviewed_dismissed' | 'deleted_immediately'
export interface ReportRow {
  id: Uuid
  reporter_id: Uuid
  reported_id: Uuid
  table_id: Uuid | null
  reason: string
  details: string | null
  created_at: Timestamp
  status: ReportStatus
  reviewed_by: Uuid | null
  reviewed_at: Timestamp | null
}

export interface NotificationRow {
  id: Uuid
  user_id: Uuid
  icon: string | null
  body: string
  read: boolean
  created_at: Timestamp
  kind: string | null
  params: Record<string, Json> | null
}

/* ───────────── money ───────────── */

export type PlanTier = 'basic' | 'premium'
export interface PlanRow {
  id: string
  tier: PlanTier
  months: number
  price_cents: number
  monthly_table_limit: number | null
  monthly_join_limit: number | null
  active: boolean
  sort: number
}

export interface SubscriptionRow {
  id: Uuid
  user_id: Uuid
  plan_id: string
  starts_at: Timestamp
  ends_at: Timestamp
  status: 'active' | 'revoked'
  source: 'admin_grant' | 'manual_payment' | 'provider'
  amount_cents: number | null
  provider_ref: string | null
  note: string | null
  created_by: Uuid | null
  created_at: Timestamp
}

export type OrderStatus = 'pending' | 'paid' | 'cancelled'
export interface SubscriptionOrderRow {
  id: Uuid
  code: string
  user_id: Uuid
  plan_id: string
  amount_cents: number
  status: OrderStatus
  subscription_id: Uuid | null
  handled_by: Uuid | null
  handled_at: Timestamp | null
  created_at: Timestamp
}

export type PaymentStatus = 'paid' | 'failed' | 'void'
export interface PaymentRow {
  id: Uuid
  user_id: Uuid | null
  table_id: Uuid | null
  amount_cents: number
  currency: string
  provider: string
  provider_ref: string | null
  status: PaymentStatus
  ticket_code: string | null
  refundable: boolean
  created_at: Timestamp
  payer_name: string | null
  table_title: string | null
  lesson_id: Uuid | null
  subscription_id: Uuid | null
}

/* ───────────── lessons ───────────── */

export type TutorStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export interface TutorRow {
  user_id: Uuid
  status: TutorStatus
  headline: string
  bio: string
  subjects: string[]
  teach_langs: string[]
  price_cents: number
  online: boolean
  in_person: boolean
  group_ok: boolean
  city: string
  lat: number | null
  lng: number | null
  years_experience: number
  education: string | null
  rejection_reason: string | null
  reviewed_by: Uuid | null
  reviewed_at: Timestamp | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface LessonSubjectRow { id: string; category: string; sort: number }

export type LessonFormat = 'online' | 'in_person'
export type LessonKind = 'individual' | 'group'
export type LessonStatus = 'scheduled' | 'cancelled'
export interface LessonRow {
  id: Uuid
  tutor_id: Uuid
  subject: string
  kind: LessonKind
  title: string | null
  starts_at: Timestamp
  duration_min: number
  format: LessonFormat
  location_note: string | null
  max_students: number
  price_cents: number
  status: LessonStatus
  created_at: Timestamp
}

export type ParticipantStatus = 'requested' | 'accepted' | 'confirmed' | 'declined' | 'cancelled'
export interface LessonParticipantRow {
  lesson_id: Uuid
  student_id: Uuid
  status: ParticipantStatus
  note: string | null
  created_at: Timestamp
}

/* ───────────── Wednesday dinner ───────────── */

export interface WednesdayRestaurantRow {
  id: Uuid
  name: string
  city: string
  address: string
  maps_link: string | null
  active: boolean
}
export interface WednesdayGroupRow {
  id: Uuid
  city: string
  dinner_date: Timestamp
  restaurant_id: Uuid | null
  created_at: Timestamp
  table_id: Uuid | null
}
export type WednesdaySignupStatus = 'signed_up' | 'grouped' | 'waitlisted' | 'cancelled'
export interface WednesdaySignupRow {
  user_id: Uuid
  dinner_date: Timestamp
  city: string
  langs: string[]
  status: WednesdaySignupStatus
  premium: boolean
  group_id: Uuid | null
  created_at: Timestamp
}

export interface AdminAuditLogRow {
  id: number
  admin_id: Uuid | null
  admin_name: string | null
  action: string
  target_type: string | null
  target_id: Uuid | null
  target_label: string | null
  details: Record<string, Json> | null
  created_at: Timestamp
}

/** Tables reachable through /rest/v1/query (sb.from(name)). */
export interface DbTables {
  profiles: ProfileRow
  taste_profiles: TasteProfileRow
  affinity: AffinityRow
  badges: BadgeRow
  blocks: BlockRow
  bans: BanRow
  connections: ConnectionRow
  tables: TableRow
  memberships: MembershipRow
  requests: RequestRow
  waitlist: WaitlistRow
  messages: MessageRow
  ratings: RatingRow
  connection_picks: ConnectionPickRow
  reports: ReportRow
  notifications: NotificationRow
  plans: PlanRow
  subscriptions: SubscriptionRow
  subscription_orders: SubscriptionOrderRow
  payments: PaymentRow
  tutors: TutorRow
  lesson_subjects: LessonSubjectRow
  lessons: LessonRow
  lesson_participants: LessonParticipantRow
  wednesday_restaurants: WednesdayRestaurantRow
  wednesday_groups: WednesdayGroupRow
  wednesday_signups: WednesdaySignupRow
}
export type DbTableName = keyof DbTables

/* ───────────── RPC results ───────────── */

/** my_plan() */
export interface MyPlan {
  tier: PlanTier
  premium_until: Timestamp | null
  is_admin: boolean | null
  home_city: string | null
  home_city_changed_at: Timestamp | null
  can_change_city_at: Timestamp | null
  table_limit: number | null
  join_limit: number | null
  tables_this_month: number
  joins_this_month: number
  pending_order: Pick<SubscriptionOrderRow, 'id' | 'code' | 'plan_id' | 'amount_cents' | 'created_at'> | null
  plans: Array<Pick<PlanRow, 'id' | 'tier' | 'months' | 'price_cents' | 'monthly_table_limit' | 'sort'>> | null
}

export interface WednesdayMember { user_id: Uuid; first_name: string; age: number | null; photo_path: string | null }
/** my_wednesday() / signup_wednesday() */
export interface MyWednesday {
  next_dinner: Timestamp
  deadline: Timestamp
  premium: boolean
  signup: {
    dinner_date: Timestamp
    deadline: Timestamp
    city: string
    status: WednesdaySignupStatus
    group_id: Uuid | null
    table_id: Uuid | null
    members: WednesdayMember[]
  } | null
}
/** get_my_wednesday_groups() */
export interface LegacyWednesdayGroup { group_id: Uuid; city: string; dinner_date: Timestamp | null }
/** get_wednesday_restaurant(p_group) */
export interface WednesdayRestaurantReveal { revealed: boolean; name: string | null; address: string | null; maps_link: string | null }

/** table_share_preview(p_code): the public part of a table, safe for signed-out visitors. */
export interface SharePreview {
  id: Uuid | null
  share_code: string
  title: string | null
  secret: boolean
  kind: TableKind
  category: string
  sport: Sport | null
  city: string
  to_city: string | null
  area: string | null
  event_datetime: Timestamp | null
  time_label: string | null
  spots: number
  taken: number
  women_only: boolean
  men_only: boolean
  host_first_name: string | null
  status: 'open' | 'full' | 'past' | 'closed'
  can_open: boolean
  reason: 'sign_in' | 'premium_city' | null
}

/** list_tutors() */
export interface TutorListing {
  user_id: Uuid
  first_name: string
  last_name: string
  photo_path: string | null
  age: number
  rating: number | null
  headline: string
  bio: string
  subjects: string[]
  teach_langs: string[]
  price_cents: number
  online: boolean
  in_person: boolean
  group_ok: boolean
  city: string
  years_experience: number
  education: string | null
  distance_km: number | null
  lessons_taught: number
  upcoming_groups: number
}

/** list_group_lessons() */
export interface GroupLessonListing {
  id: Uuid
  tutor_id: Uuid
  tutor_name: string
  tutor_photo_path: string | null
  subject: string
  title: string | null
  starts_at: Timestamp
  duration_min: number
  format: LessonFormat
  location_note: string | null
  max_students: number
  seats_taken: number
  price_cents: number
  city: string
  my_status: ParticipantStatus | null
}

/** my_lessons() */
export interface StudentLesson {
  id: Uuid
  kind: LessonKind
  subject: string
  title: string | null
  starts_at: Timestamp
  duration_min: number
  format: LessonFormat
  location_note: string | null
  price_cents: number
  lesson_status: LessonStatus
  my_status: ParticipantStatus
  tutor_id: Uuid
  tutor_name: string
  tutor_photo_path: string | null
  ticket_code: string | null
}
export interface TutorLessonStudent { student_id: Uuid; status: ParticipantStatus; note: string | null; name: string; photo_path: string | null; age: number }
export interface TutorLesson {
  id: Uuid
  kind: LessonKind
  subject: string
  title: string | null
  starts_at: Timestamp
  duration_min: number
  format: LessonFormat
  location_note: string | null
  price_cents: number
  lesson_status: LessonStatus
  max_students: number
  students: TutorLessonStudent[]
}
export interface MyLessons { as_student: StudentLesson[]; as_tutor: TutorLesson[]; tutor: TutorRow | null }

/** get_lesson_room(p_lesson) */
export interface LessonRoomAccess {
  room: string | null
  starts_at: Timestamp
  duration_min: number
  display_name: string
  provider: 'jitsi-jwt' | 'jaas' | 'jitsi'
  domain: string
  room_name: string | null
  jwt: string | null
  jwt_expires_at: Timestamp | null
  script_url: string
  moderator: boolean
}
