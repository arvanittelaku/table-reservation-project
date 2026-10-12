import { sb } from '../backendClient'
import { callRpc as rpc } from './rpc'
import type { GroupLessonListing, LessonFormat, LessonRoomAccess, MyLessons, TutorListing, TutorRow, Uuid } from '../types/db'

export interface TutorFilters {
  subject?: string | null
  category?: string | null
  format?: LessonFormat | null
  group?: boolean | null
  maxPrice?: number | null
  lat?: number | null
  lng?: number | null
  radiusKm?: number | null
}
export interface GroupFilters { subject?: string | null; category?: string | null }
export interface BookingInput { tutorId: Uuid; subject: string; startsAt: string; duration: number; format: LessonFormat; note?: string | null }
export interface GroupLessonInput { subject: string; title: string; startsAt: string; duration: number; format: LessonFormat; maxStudents: number; priceCents: number; locationNote?: string | null }
/** Editable tutor columns (tutors row without the review fields). */
export type TutorProfileInput = Omit<TutorRow, 'user_id' | 'status' | 'rejection_reason' | 'reviewed_by' | 'reviewed_at' | 'created_at' | 'updated_at'>

export const lessonsApi = {
  listTutors: ({ subject, category, format, group, maxPrice, lat, lng, radiusKm }: TutorFilters = {}) =>
    rpc<TutorListing[]>('list_tutors', {
      p_subject: subject || null,
      p_category: category || null,
      p_format: format || null,
      p_group: group ?? null,
      p_max_price: maxPrice ?? null,
      p_lat: lat ?? null,
      p_lng: lng ?? null,
      p_radius_km: radiusKm ?? null,
    }),
  listGroupLessons: ({ subject, category }: GroupFilters = {}) =>
    rpc<GroupLessonListing[]>('list_group_lessons', { p_subject: subject || null, p_category: category || null }),
  book: ({ tutorId, subject, startsAt, duration, format, note }: BookingInput) =>
    rpc<Uuid>('book_lesson', { p_tutor: tutorId, p_subject: subject, p_starts_at: startsAt, p_duration: duration, p_format: format, p_note: note || null }),
  respond: (lessonId: Uuid, studentId: Uuid, accept: boolean) =>
    rpc<null>('respond_lesson_request', { p_lesson: lessonId, p_student: studentId, p_accept: accept }),
  createGroup: ({ subject, title, startsAt, duration, format, maxStudents, priceCents, locationNote }: GroupLessonInput) =>
    rpc<Uuid>('create_group_lesson', {
      p_subject: subject, p_title: title, p_starts_at: startsAt, p_duration: duration, p_format: format,
      p_max_students: maxStudents, p_price_cents: priceCents, p_location_note: locationNote || null,
    }),
  joinGroup: (lessonId: Uuid) => rpc<null>('join_group_lesson', { p_lesson: lessonId }),
  /** Resolves to the ticket code. */
  confirmSeat: (lessonId: Uuid) => rpc<string>('confirm_lesson_seat', { p_lesson: lessonId }),
  cancel: (lessonId: Uuid) => rpc<null>('cancel_lesson', { p_lesson: lessonId }),
  room: (lessonId: Uuid) => rpc<LessonRoomAccess>('get_lesson_room', { p_lesson: lessonId }),
  mine: () => rpc<MyLessons>('my_lessons'),

  async saveTutorProfile(userId: Uuid, profile: TutorProfileInput, exists: boolean): Promise<void> {
    const row = { ...profile, user_id: userId }
    const q = exists
      ? sb.from('tutors').update(row).eq('user_id', userId)
      : sb.from('tutors').insert(row)
    const { error } = await q
    if (error) throw new Error(error.message)
  },
}

/** Fallback Jitsi server, only used if the backend does not say which one to use
 *  (get_lesson_room returns `domain`: 8x8.vc with JaaS, else the server's JITSI_DOMAIN). */
export const JITSI_DOMAIN = import.meta.env?.VITE_JITSI_DOMAIN || 'meet.jit.si'
export const JITSI_ROOM_PREFIX = import.meta.env?.VITE_JITSI_ROOM_PREFIX || ''

/** Where and how to open a lesson room, from get_lesson_room's result:
 *  { domain, roomName, jwt, scriptUrl, iframeUrl(displayName) }. */
export interface JitsiTarget { domain: string; roomName: string | null; jwt: string | null; scriptUrl: string; iframeUrl: (displayName: string) => string | null }

export function jitsiTarget(room: Partial<LessonRoomAccess> | null | undefined): JitsiTarget {
  const domain = room?.domain || JITSI_DOMAIN
  const roomName = room?.room_name || (room?.room ? `${JITSI_ROOM_PREFIX}${room.room}` : null)
  const jwt = room?.jwt || null
  const scriptUrl = room?.script_url || `https://${domain}/external_api.js`
  const iframeUrl = (displayName: string) => {
    if (!roomName) return null
    const cfg = [
      `userInfo.displayName=${encodeURIComponent(JSON.stringify(displayName || ''))}`,
      'config.prejoinPageEnabled=false',
      'config.disableDeepLinking=true',
      'interfaceConfig.SHOW_JITSI_WATERMARK=false',
      'interfaceConfig.SHOW_BRAND_WATERMARK=false',
      'interfaceConfig.SHOW_POWERED_BY=false',
      'interfaceConfig.MOBILE_APP_PROMO=false',
    ].join('&')
    const path = roomName.split('/').map(encodeURIComponent).join('/')
    return `https://${domain}/${path}${jwt ? `?jwt=${encodeURIComponent(jwt)}` : ''}#${cfg}`
  }
  return { domain, roomName, jwt, scriptUrl, iframeUrl }
}

const scripts = new Map<string, Promise<JitsiMeetExternalAPIConstructor>>()
/** Load Jitsi's External API script once per URL (rejects on error or after `timeoutMs`). */
export function loadJitsiApi(url: string, timeoutMs = 12000): Promise<JitsiMeetExternalAPIConstructor> {
  if (typeof window !== 'undefined' && window.JitsiMeetExternalAPI && scripts.has(url)) {
    return Promise.resolve(window.JitsiMeetExternalAPI)
  }
  let loading = scripts.get(url)
  if (!loading) {
    const p = new Promise<JitsiMeetExternalAPIConstructor>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = url
      s.async = true
      const timer = setTimeout(() => { s.remove(); reject(new Error('jitsi_script_timeout')) }, timeoutMs)
      s.onload = () => {
        clearTimeout(timer)
        if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI)
        else reject(new Error('jitsi_script_invalid'))
      }
      s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('jitsi_script_error')) }
      document.head.appendChild(s)
    })
    p.catch(() => scripts.delete(url)) // allow a retry
    scripts.set(url, p)
    loading = p
  }
  return loading
}
