import { sb } from '../supabaseClient'

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args)
  if (error) {
    const e = new Error(error.message || String(error))
    e.code = error.code
    throw e
  }
  return data
}

export const lessonsApi = {
  listTutors: ({ subject, category, format, group, maxPrice, lat, lng, radiusKm } = {}) =>
    rpc('list_tutors', {
      p_subject: subject || null,
      p_category: category || null,
      p_format: format || null,
      p_group: group ?? null,
      p_max_price: maxPrice ?? null,
      p_lat: lat ?? null,
      p_lng: lng ?? null,
      p_radius_km: radiusKm ?? null,
    }),
  listGroupLessons: ({ subject, category } = {}) =>
    rpc('list_group_lessons', { p_subject: subject || null, p_category: category || null }),
  book: ({ tutorId, subject, startsAt, duration, format, note }) =>
    rpc('book_lesson', { p_tutor: tutorId, p_subject: subject, p_starts_at: startsAt, p_duration: duration, p_format: format, p_note: note || null }),
  respond: (lessonId, studentId, accept) =>
    rpc('respond_lesson_request', { p_lesson: lessonId, p_student: studentId, p_accept: accept }),
  createGroup: ({ subject, title, startsAt, duration, format, maxStudents, priceCents, locationNote }) =>
    rpc('create_group_lesson', {
      p_subject: subject, p_title: title, p_starts_at: startsAt, p_duration: duration, p_format: format,
      p_max_students: maxStudents, p_price_cents: priceCents, p_location_note: locationNote || null,
    }),
  joinGroup: (lessonId) => rpc('join_group_lesson', { p_lesson: lessonId }),
  confirmSeat: (lessonId) => rpc('confirm_lesson_seat', { p_lesson: lessonId }),
  cancel: (lessonId) => rpc('cancel_lesson', { p_lesson: lessonId }),
  room: (lessonId) => rpc('get_lesson_room', { p_lesson: lessonId }),
  mine: () => rpc('my_lessons'),

  async saveTutorProfile(userId, profile, exists) {
    const row = { ...profile, user_id: userId }
    const q = exists
      ? sb.from('tutors').update(row).eq('user_id', userId)
      : sb.from('tutors').insert(row)
    const { error } = await q
    if (error) throw new Error(error.message)
  },
}

/** Jitsi server for lesson video. meet.jit.si limits embedded calls; set
 *  VITE_JITSI_DOMAIN (e.g. 8x8.vc for JaaS, or your own server) for production. */
export const JITSI_DOMAIN = import.meta.env?.VITE_JITSI_DOMAIN || 'meet.jit.si'
export const JITSI_ROOM_PREFIX = import.meta.env?.VITE_JITSI_ROOM_PREFIX || ''
