import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { getAvatarUrl } from '../../api/storage'
import { lessonsApi, JITSI_DOMAIN, JITSI_ROOM_PREFIX } from '../../api/lessons'
import { LESSON_CATEGORIES, ALL_SUBJECTS, DURATIONS } from '../../lib/lessonSubjects'
import { coordsOf } from '../../lib/kosovoGeo'
import { fmtDate, fmtRelative } from '../admin/ui.jsx'
import './lessons.css'

const euros = (cents) => `€${(Number(cents || 0) / 100).toFixed(cents % 100 ? 2 : 0)}`
const TEACH_LANGS = ['sq', 'en', 'de', 'fr', 'it', 'tr', 'sr', 'mk', 'es']
const RADII = [5, 10, 25, 50]
const PRICE_CAPS = [1000, 1500, 2000, 3000]

function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const run = useCallback(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => run(), [run])
  return { ...state, reload: run }
}

function LAvatar({ path, name, size = 44 }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    if (path) getAvatarUrl(path).then((u) => alive && setUrl(u)).catch(() => {})
    return () => { alive = false }
  }, [path])
  const initials = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase()
  return <span className="ls-avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>{url ? <img src={url} alt="" /> : initials}</span>
}

/* Category row + strict subject row (a German learner never sees English teachers). */
function SubjectFilter({ category, subject, onCategory, onSubject }) {
  const { t } = useI18n()
  const cat = LESSON_CATEGORIES.find((c) => c.id === category)
  return (
    <>
      <div className="cat-row ls-cats" role="tablist" aria-label={t('lessons.categoryLabel')}>
        <button type="button" className={`chip ${!category ? 'on' : ''}`} onClick={() => { onCategory(null); onSubject(null) }}>{t('lessons.allCategories')}</button>
        {LESSON_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={`chip ${category === c.id ? 'on' : ''}`} onClick={() => { onCategory(c.id); onSubject(null) }}>
            {t(`lessons.categories.${c.id}`)}
          </button>
        ))}
      </div>
      {cat && (
        <div className="cat-row ls-subjects" role="tablist" aria-label={t('lessons.subjectLabel')}>
          <button type="button" className={`chip ${!subject ? 'on' : ''}`} onClick={() => onSubject(null)}>{t('lessons.allInCategory')}</button>
          {cat.subjects.map((s) => (
            <button key={s} type="button" className={`chip ${subject === s ? 'on' : ''}`} onClick={() => onSubject(s)}>{t(`lessons.subjects.${s}`)}</button>
          ))}
        </div>
      )}
    </>
  )
}

export default function Lessons({ authUser, cities, city, showToast, mapErr, myName }) {
  const { t } = useI18n()
  const [view, setView] = useState('find')
  const [category, setCategory] = useState(null)
  const [subject, setSubject] = useState(null)
  const [openTutor, setOpenTutor] = useState(null)
  const [room, setRoom] = useState(null)
  const [mineKey, setMineKey] = useState(0)
  const goMine = () => { setMineKey((k) => k + 1); setView('mine') }

  return (
    <div className="ls">
      <div className="ls-head">
        <h2>{t('lessons.title')}</h2>
        <p className="muted">{t('lessons.subtitle')}</p>
      </div>
      <div className="ls-views" role="tablist">
        {['find', 'groups', 'mine', 'teach'].map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => (v === 'mine' ? goMine() : setView(v))}>
            {t(`lessons.views.${v}`)}
          </button>
        ))}
      </div>

      {(view === 'find' || view === 'groups') && (
        <SubjectFilter category={category} subject={subject} onCategory={setCategory} onSubject={setSubject} />
      )}

      {view === 'find' && <FindTutors category={category} subject={subject} city={city} onOpen={setOpenTutor} mapErr={mapErr} />}
      {view === 'groups' && <GroupLessons category={category} subject={subject} showToast={showToast} mapErr={mapErr} onJoined={goMine} />}
      {view === 'mine' && <MyLessons key={mineKey} authUser={authUser} showToast={showToast} mapErr={mapErr} onEnterRoom={setRoom} />}
      {view === 'teach' && <TeachForm authUser={authUser} cities={cities} showToast={showToast} mapErr={mapErr} />}

      {openTutor && (
        <TutorSheet tutor={openTutor} preferredSubject={subject} onClose={() => setOpenTutor(null)} showToast={showToast} mapErr={mapErr}
          onBooked={() => { setOpenTutor(null); goMine() }} />
      )}
      {room && <VideoRoom lesson={room} myName={myName} onClose={() => setRoom(null)} mapErr={mapErr} />}
    </div>
  )
}

/* ───────────── Find teachers ───────────── */
function FindTutors({ category, subject, city, onOpen, mapErr }) {
  const { t } = useI18n()
  const [format, setFormat] = useState('')
  const [near, setNear] = useState(null) // { lat, lng, source: 'gps' | 'city' }
  const [radius, setRadius] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [locating, setLocating] = useState(false)

  const useNearMe = () => {
    const fallback = () => {
      const c = coordsOf(city)
      if (c) setNear({ lat: c[0], lng: c[1], source: 'city' })
      setLocating(false)
    }
    if (!navigator.geolocation) return fallback()
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' }); setLocating(false) },
      fallback,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    )
  }

  const { data, loading, error, reload } = useAsync(
    () => lessonsApi.listTutors({
      subject, category: subject ? null : category, format: format || null,
      maxPrice: maxPrice ? Number(maxPrice) : null,
      lat: near?.lat, lng: near?.lng, radiusKm: near && radius ? Number(radius) : null,
    }),
    [subject, category, format, near?.lat, near?.lng, radius, maxPrice],
  )
  const tutors = data || []

  return (
    <div className="ls-section">
      <div className="ls-filters">
        <div className="ls-seg">
          {[['', t('lessons.formatAll')], ['online', t('lessons.online')], ['in_person', t('lessons.inPerson')]].map(([v, l]) => (
            <button key={v || 'all'} type="button" className={format === v ? 'on' : ''} onClick={() => setFormat(v)}>{l}</button>
          ))}
        </div>
        <button type="button" className={`chip ${near ? 'on' : ''}`} onClick={() => (near ? setNear(null) : useNearMe())} disabled={locating}>
          {locating ? t('lessons.locating') : near ? t('lessons.nearOn', { place: near.source === 'gps' ? t('lessons.yourLocation') : city }) : t('lessons.nearMe')}
        </button>
        {near && (
          <select className="ls-select" value={radius} onChange={(e) => setRadius(e.target.value)} aria-label={t('lessons.radius')}>
            <option value="">{t('lessons.anyDistance')}</option>
            {RADII.map((r) => <option key={r} value={r}>{t('lessons.withinKm', { km: r })}</option>)}
          </select>
        )}
        <select className="ls-select" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} aria-label={t('lessons.maxPrice')}>
          <option value="">{t('lessons.anyPrice')}</option>
          {PRICE_CAPS.map((p) => <option key={p} value={p}>{t('lessons.upTo', { price: euros(p) })}</option>)}
        </select>
      </div>

      {error && <p className="age-warn">{mapErr(error)} <button type="button" className="link-btn" onClick={reload}>{t('lessons.retry')}</button></p>}
      {loading && !data && <p className="muted pad">{t('lessons.loading')}</p>}
      {!loading && !error && tutors.length === 0 && (
        <div className="empty">
          <p><strong>{subject ? t('lessons.noTutorsSubject', { subject: t(`lessons.subjects.${subject}`) }) : t('lessons.noTutors')}</strong></p>
          <p className="muted">{t('lessons.noTutorsHint')}</p>
        </div>
      )}
      <p className="count">{!loading && tutors.length > 0 && t('lessons.tutorsCount', { count: tutors.length })}</p>
      <div className="ls-list">
        {tutors.map((tu) => (
          <button key={tu.user_id} type="button" className="ls-card" onClick={() => onOpen(tu)}>
            <LAvatar path={tu.photo_path} name={`${tu.first_name} ${tu.last_name}`} size={52} />
            <span className="ls-card-main">
              <span className="ls-card-top">
                <strong>{tu.first_name} {tu.last_name}</strong>
                <span className="ls-price">{tu.price_cents ? t('lessons.perHour', { price: euros(tu.price_cents) }) : t('lessons.free')}</span>
              </span>
              <span className="ls-headline">{tu.headline}</span>
              <span className="ls-tags">
                {tu.subjects.slice(0, 4).map((s) => <span key={s} className={`ls-tag ${s === subject ? 'hit' : ''}`}>{t(`lessons.subjects.${s}`)}</span>)}
                {tu.subjects.length > 4 && <span className="ls-tag more">+{tu.subjects.length - 4}</span>}
              </span>
              <span className="ls-meta">
                {tu.online && <span className="badge ls-online">{t('lessons.online')}</span>}
                {tu.in_person && <span className="badge ls-inperson">{t('lessons.inPerson')} · {tu.city}</span>}
                {tu.distance_km != null && <span className="ls-dist">{t('lessons.kmAway', { km: tu.distance_km })}</span>}
                {tu.years_experience > 0 && <span className="muted">{t('lessons.yearsExp', { count: tu.years_experience })}</span>}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ───────────── Teacher sheet + booking ───────────── */
function TutorSheet({ tutor, preferredSubject, onClose, onBooked, showToast, mapErr }) {
  const { t } = useI18n()
  const tomorrow = new Date(Date.now() + 864e5)
  const pad = (n) => String(n).padStart(2, '0')
  const [subject, setSubject] = useState(tutor.subjects.includes(preferredSubject) ? preferredSubject : tutor.subjects[0])
  const [format, setFormat] = useState(tutor.online ? 'online' : 'in_person')
  const [date, setDate] = useState(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`)
  const [time, setTime] = useState('18:00')
  const [duration, setDuration] = useState(60)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const lessonPrice = Math.round((tutor.price_cents * duration) / 60)

  const submit = async () => {
    const startsAt = new Date(`${date}T${time}`)
    if (Number.isNaN(startsAt.getTime())) return
    setBusy(true)
    try {
      await lessonsApi.book({ tutorId: tutor.user_id, subject, startsAt: startsAt.toISOString(), duration, format, note })
      showToast(t('lessons.toastRequested', { name: tutor.first_name }))
      onBooked()
    } catch (err) {
      showToast(mapErr(err))
      setBusy(false)
    }
  }

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet ls-sheet" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ls-close" onClick={onClose} aria-label={t('lessons.close')}>×</button>
        <div className="ls-sheet-head">
          <LAvatar path={tutor.photo_path} name={`${tutor.first_name} ${tutor.last_name}`} size={72} />
          <div>
            <h2>{tutor.first_name} {tutor.last_name}</h2>
            <p className="ls-headline">{tutor.headline}</p>
            <p className="muted small">
              {[tutor.years_experience > 0 && t('lessons.yearsExp', { count: tutor.years_experience }),
                tutor.lessons_taught > 0 && t('lessons.lessonsTaught', { count: tutor.lessons_taught }),
                tutor.distance_km != null && t('lessons.kmAway', { km: tutor.distance_km })].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <p className="ls-bio">{tutor.bio}</p>
        {tutor.education && <p className="muted small">{t('lessons.education')}: {tutor.education}</p>}
        <p className="muted small">{t('lessons.teachesIn')}: {(tutor.teach_langs || []).map((l) => t(`lessons.langs.${l}`)).join(', ')}</p>

        <div className="ls-book">
          <h3>{t('lessons.bookTitle')}</h3>
          <label className="f-label">{t('lessons.subjectLabel')}</label>
          <div className="cat-row wrap">
            {tutor.subjects.map((s) => (
              <button key={s} type="button" className={`chip ${subject === s ? 'on' : ''}`} onClick={() => setSubject(s)}>{t(`lessons.subjects.${s}`)}</button>
            ))}
          </div>
          {tutor.online && tutor.in_person && (
            <>
              <label className="f-label">{t('lessons.formatLabel')}</label>
              <div className="ls-seg">
                <button type="button" className={format === 'online' ? 'on' : ''} onClick={() => setFormat('online')}>{t('lessons.onlineVideo')}</button>
                <button type="button" className={format === 'in_person' ? 'on' : ''} onClick={() => setFormat('in_person')}>{t('lessons.inPersonCity', { city: tutor.city })}</button>
              </div>
            </>
          )}
          <div className="datetime-row">
            <div><label className="f-label" htmlFor="ls-date">{t('lessons.date')}</label><input id="ls-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><label className="f-label" htmlFor="ls-time">{t('lessons.time')}</label><input id="ls-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          <label className="f-label">{t('lessons.duration')}</label>
          <div className="cat-row wrap">
            {DURATIONS.map((d) => <button key={d} type="button" className={`chip ${duration === d ? 'on' : ''}`} onClick={() => setDuration(d)}>{t('lessons.minutes', { count: d })}</button>)}
          </div>
          <label className="f-label" htmlFor="ls-note">{t('lessons.noteLabel')}</label>
          <textarea id="ls-note" className="input" rows={3} maxLength={500} placeholder={t('lessons.notePh')} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="ls-price-box">
            <span>{t('lessons.lessonPrice', { minutes: duration })}</span><strong>{lessonPrice ? euros(lessonPrice) : t('lessons.free')}</strong>
            <span className="muted small">{t('lessons.paidToTeacher')}</span>
            <span>{t('lessons.bookingFee')}</span><strong>€2</strong>
          </div>
          <button type="button" className="btn primary full" disabled={busy} onClick={submit}>{busy ? t('lessons.sending') : t('lessons.sendRequest')}</button>
          <p className="fee-note">{t('lessons.requestNote')}</p>
        </div>
      </div>
    </div>
  )
}

/* ───────────── Group lessons ───────────── */
function GroupLessons({ category, subject, showToast, mapErr, onJoined }) {
  const { t, locale } = useI18n()
  const { data, loading, error, reload } = useAsync(
    () => lessonsApi.listGroupLessons({ subject, category: subject ? null : category }), [subject, category])
  const rows = data || []
  const join = async (l) => {
    try {
      await lessonsApi.joinGroup(l.id)
      showToast(t('lessons.toastJoinedGroup'))
      onJoined()
    } catch (err) { showToast(mapErr(err)) }
  }
  return (
    <div className="ls-section">
      {error && <p className="age-warn">{mapErr(error)} <button type="button" className="link-btn" onClick={reload}>{t('lessons.retry')}</button></p>}
      {loading && !data && <p className="muted pad">{t('lessons.loading')}</p>}
      {!loading && rows.length === 0 && <div className="empty"><p><strong>{t('lessons.noGroups')}</strong></p><p className="muted">{t('lessons.noGroupsHint')}</p></div>}
      <div className="ls-list">
        {rows.map((l) => {
          const full = Number(l.seats_taken) >= l.max_students
          return (
            <div key={l.id} className="ls-card static">
              <LAvatar path={l.tutor_photo_path} name={l.tutor_name} size={44} />
              <span className="ls-card-main">
                <span className="ls-card-top"><strong>{l.title}</strong><span className="ls-price">{l.price_cents ? euros(l.price_cents) : t('lessons.free')}</span></span>
                <span className="ls-tags"><span className="ls-tag hit">{t(`lessons.subjects.${l.subject}`)}</span><span className="ls-tag">{t('lessons.groupBadge', { taken: l.seats_taken, max: l.max_students })}</span></span>
                <span className="ls-meta">
                  <span>{fmtDate(l.starts_at, locale)} · {t('lessons.minutes', { count: l.duration_min })}</span>
                  <span className={`badge ${l.format === 'online' ? 'ls-online' : 'ls-inperson'}`}>{l.format === 'online' ? t('lessons.online') : `${t('lessons.inPerson')} · ${l.city}`}</span>
                </span>
                <span className="muted small">{t('lessons.withTutor', { name: l.tutor_name })}</span>
              </span>
              <span className="ls-card-action">
                {l.my_status && ['accepted', 'confirmed'].includes(l.my_status)
                  ? <span className="badge joined">{t(`lessons.status.${l.my_status}`)}</span>
                  : <button type="button" className="btn primary sm" disabled={full} onClick={() => join(l)}>{full ? t('lessons.full') : t('lessons.join')}</button>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ───────────── My lessons (student + teacher) ───────────── */
function MyLessons({ authUser, showToast, mapErr, onEnterRoom }) {
  const { t, locale } = useI18n()
  const { data, loading, error, reload } = useAsync(() => lessonsApi.mine(), [authUser?.id])
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(id) }, [])

  const act = (fn, ok) => async () => {
    try { const r = await fn(); showToast(typeof ok === 'function' ? ok(r) : ok); reload() } catch (err) { showToast(mapErr(err)) }
  }
  const now = Date.now()
  const roomOpen = (l) => {
    const s = new Date(l.starts_at).getTime()
    return now >= s - 15 * 60000 && now <= s + (l.duration_min + 30) * 60000
  }
  const isPast = (l) => new Date(l.starts_at).getTime() + l.duration_min * 60000 < now
  const student = data?.as_student || []
  const tutorLessons = data?.as_tutor || []
  const tutor = data?.tutor

  const JoinButton = ({ l }) => l.format === 'online'
    ? <button type="button" className="btn primary sm" disabled={!roomOpen(l)} onClick={() => onEnterRoom(l)}>
        {roomOpen(l) ? t('lessons.enterRoom') : t('lessons.roomOpensIn', { when: fmtRelative(new Date(new Date(l.starts_at).getTime() - 15 * 60000).toISOString(), locale) })}
      </button>
    : <span className="muted small">{l.location_note || t('lessons.inPerson')}</span>

  if (loading && !data) return <p className="muted pad">{t('lessons.loading')}</p>
  return (
    <div className="ls-section">
      {error && <p className="age-warn">{mapErr(error)} <button type="button" className="link-btn" onClick={reload}>{t('lessons.retry')}</button></p>}

      <h3 className="ls-h3">{t('lessons.asStudent')}</h3>
      {student.length === 0 && <p className="muted small">{t('lessons.noStudentLessons')}</p>}
      {student.map((l) => {
        const cancelled = l.lesson_status === 'cancelled' || ['declined', 'cancelled'].includes(l.my_status)
        return (
          <div key={l.id} className={`ls-item ${cancelled || isPast(l) ? 'dim' : ''}`}>
            <div className="ls-item-top">
              <strong>{t(`lessons.subjects.${l.subject}`)}{l.title ? ` · ${l.title}` : ''}</strong>
              <span className={`ls-status st-${cancelled ? 'cancelled' : l.my_status}`}>{t(`lessons.status.${cancelled ? 'cancelled' : l.my_status}`)}</span>
            </div>
            <p className="muted small">{t('lessons.withTutor', { name: l.tutor_name })} · {fmtDate(l.starts_at, locale)} · {t('lessons.minutes', { count: l.duration_min })} · {l.format === 'online' ? t('lessons.online') : t('lessons.inPerson')}</p>
            {!cancelled && !isPast(l) && (
              <div className="ls-item-actions">
                {l.my_status === 'accepted' && <button type="button" className="btn primary sm" onClick={act(() => lessonsApi.confirmSeat(l.id), (code) => t('lessons.toastConfirmed', { code }))}>{t('lessons.confirmFee')}</button>}
                {l.my_status === 'confirmed' && <JoinButton l={l} />}
                {l.my_status === 'confirmed' && l.ticket_code && <span className="muted small">{t('lessons.ticket')}: {l.ticket_code}</span>}
                {l.my_status === 'requested' && <span className="muted small">{t('lessons.waitingTeacher')}</span>}
                <button type="button" className="btn ghost sm" onClick={act(() => lessonsApi.cancel(l.id), t('lessons.toastCancelled'))}>{t('lessons.cancel')}</button>
              </div>
            )}
          </div>
        )
      })}

      {tutor && (
        <>
          <div className="ls-h3-row">
            <h3 className="ls-h3">{t('lessons.asTeacher')}</h3>
            {tutor.status === 'approved' && tutor.group_ok && <button type="button" className="btn ghost sm" onClick={() => setShowGroupForm(true)}>{t('lessons.newGroup')}</button>}
          </div>
          {tutor.status !== 'approved' && <p className="muted small">{t(`lessons.tutorStatus.${tutor.status}`)}</p>}
          {tutorLessons.length === 0 && tutor.status === 'approved' && <p className="muted small">{t('lessons.noTeacherLessons')}</p>}
          {tutorLessons.map((l) => {
            const active = (l.students || []).filter((s) => ['requested', 'accepted', 'confirmed'].includes(s.status))
            const cancelled = l.lesson_status === 'cancelled'
            return (
              <div key={l.id} className={`ls-item ${cancelled || isPast(l) ? 'dim' : ''}`}>
                <div className="ls-item-top">
                  <strong>{t(`lessons.subjects.${l.subject}`)}{l.title ? ` · ${l.title}` : ''}</strong>
                  <span className="ls-status">{cancelled ? t('lessons.status.cancelled') : l.kind === 'group' ? t('lessons.groupBadge', { taken: active.length, max: l.max_students }) : t('lessons.individual')}</span>
                </div>
                <p className="muted small">{fmtDate(l.starts_at, locale)} · {t('lessons.minutes', { count: l.duration_min })} · {l.format === 'online' ? t('lessons.online') : t('lessons.inPerson')}</p>
                {active.map((s) => (
                  <div key={s.student_id} className="ls-student">
                    <LAvatar path={s.photo_path} name={s.name} size={30} />
                    <span className="ls-student-main"><strong>{s.name}{s.age ? `, ${s.age}` : ''}</strong>{s.note && <span className="muted small">“{s.note}”</span>}</span>
                    {s.status === 'requested' && !cancelled ? (
                      <span className="ls-item-actions">
                        <button type="button" className="btn primary sm" onClick={act(() => lessonsApi.respond(l.id, s.student_id, true), t('lessons.toastAccepted'))}>{t('lessons.accept')}</button>
                        <button type="button" className="btn ghost sm" onClick={act(() => lessonsApi.respond(l.id, s.student_id, false), t('lessons.toastDeclined'))}>{t('lessons.decline')}</button>
                      </span>
                    ) : <span className={`ls-status st-${s.status}`}>{t(`lessons.status.${s.status}`)}</span>}
                  </div>
                ))}
                {!cancelled && !isPast(l) && (
                  <div className="ls-item-actions">
                    {active.some((s) => s.status === 'confirmed') && <JoinButton l={l} />}
                    <button type="button" className="btn ghost sm" onClick={act(() => lessonsApi.cancel(l.id), t('lessons.toastCancelled'))}>{t('lessons.cancelLesson')}</button>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
      {showGroupForm && tutor && <GroupForm tutor={tutor} onClose={() => setShowGroupForm(false)} onCreated={() => { setShowGroupForm(false); reload() }} showToast={showToast} mapErr={mapErr} />}
    </div>
  )
}

function GroupForm({ tutor, onClose, onCreated, showToast, mapErr }) {
  const { t } = useI18n()
  const d = new Date(Date.now() + 2 * 864e5)
  const pad = (n) => String(n).padStart(2, '0')
  const [f, setF] = useState({
    subject: tutor.subjects[0], title: '', date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: '18:00',
    duration: 60, format: tutor.online ? 'online' : 'in_person', max: 6, price: Math.round(tutor.price_cents / 100 / 2) || 0, location: '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const submit = async () => {
    setBusy(true)
    try {
      await lessonsApi.createGroup({
        subject: f.subject, title: f.title.trim(), startsAt: new Date(`${f.date}T${f.time}`).toISOString(), duration: Number(f.duration),
        format: f.format, maxStudents: Number(f.max), priceCents: Math.round(Number(f.price) * 100), locationNote: f.location,
      })
      showToast(t('lessons.toastGroupCreated'))
      onCreated()
    } catch (err) { showToast(mapErr(err)); setBusy(false) }
  }
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet ls-sheet" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ls-close" onClick={onClose} aria-label={t('lessons.close')}>×</button>
        <h2>{t('lessons.newGroup')}</h2>
        <label className="f-label">{t('lessons.subjectLabel')}</label>
        <div className="cat-row wrap">{tutor.subjects.map((s) => <button key={s} type="button" className={`chip ${f.subject === s ? 'on' : ''}`} onClick={() => setF({ ...f, subject: s })}>{t(`lessons.subjects.${s}`)}</button>)}</div>
        <label className="f-label" htmlFor="gf-title">{t('lessons.groupTitle')}</label>
        <input id="gf-title" className="input" maxLength={120} placeholder={t('lessons.groupTitlePh')} value={f.title} onChange={set('title')} />
        <div className="datetime-row">
          <div><label className="f-label">{t('lessons.date')}</label><input className="input" type="date" value={f.date} onChange={set('date')} /></div>
          <div><label className="f-label">{t('lessons.time')}</label><input className="input" type="time" value={f.time} onChange={set('time')} /></div>
        </div>
        <label className="f-label">{t('lessons.duration')}</label>
        <div className="cat-row wrap">{DURATIONS.map((x) => <button key={x} type="button" className={`chip ${Number(f.duration) === x ? 'on' : ''}`} onClick={() => setF({ ...f, duration: x })}>{t('lessons.minutes', { count: x })}</button>)}</div>
        {tutor.online && tutor.in_person && (
          <div className="ls-seg">
            <button type="button" className={f.format === 'online' ? 'on' : ''} onClick={() => setF({ ...f, format: 'online' })}>{t('lessons.online')}</button>
            <button type="button" className={f.format === 'in_person' ? 'on' : ''} onClick={() => setF({ ...f, format: 'in_person' })}>{t('lessons.inPerson')}</button>
          </div>
        )}
        {f.format === 'in_person' && (<><label className="f-label">{t('lessons.location')}</label><input className="input" maxLength={200} value={f.location} onChange={set('location')} placeholder={t('lessons.locationPh')} /></>)}
        <label className="f-label">{t('lessons.maxStudents', { count: f.max })}</label>
        <input type="range" className="range" min={2} max={30} value={f.max} onChange={set('max')} />
        <label className="f-label" htmlFor="gf-price">{t('lessons.pricePerStudent')}</label>
        <input id="gf-price" className="input" type="number" min={0} max={1000} value={f.price} onChange={set('price')} />
        <button type="button" className="btn primary full" disabled={busy || f.title.trim().length < 3} onClick={submit}>{busy ? t('lessons.sending') : t('lessons.publishGroup')}</button>
      </div>
    </div>
  )
}

/* ───────────── Become / edit teacher ───────────── */
function TeachForm({ authUser, cities, showToast, mapErr }) {
  const { t } = useI18n()
  const { data, loading, reload } = useAsync(() => lessonsApi.mine(), [authUser?.id])
  const existing = data?.tutor
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pickCat, setPickCat] = useState(LESSON_CATEGORIES[0].id)

  useEffect(() => {
    if (loading) return
    setF({
      headline: existing?.headline || '', bio: existing?.bio || '', subjects: existing?.subjects || [],
      teach_langs: existing?.teach_langs || ['sq'], price: existing ? existing.price_cents / 100 : 10,
      online: existing?.online ?? true, in_person: existing?.in_person ?? false, group_ok: existing?.group_ok ?? false,
      city: existing?.city || cities[0], years: existing?.years_experience ?? 0, education: existing?.education || '',
      lat: existing?.lat ?? null, lng: existing?.lng ?? null,
    })
  }, [loading, existing, cities])

  if (!f) return <p className="muted pad">{t('lessons.loading')}</p>
  const toggle = (k, v) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }))
  const valid = f.headline.trim().length >= 5 && f.bio.trim().length >= 30 && f.subjects.length >= 1 && f.subjects.length <= 12
    && (f.online || f.in_person) && f.teach_langs.length > 0 && Number(f.price) >= 0 && Number(f.price) <= 200

  const save = async () => {
    setBusy(true)
    try {
      const c = coordsOf(f.city)
      await lessonsApi.saveTutorProfile(authUser.id, {
        headline: f.headline.trim(), bio: f.bio.trim(), subjects: f.subjects.filter((s) => ALL_SUBJECTS.includes(s)),
        teach_langs: f.teach_langs, price_cents: Math.round(Number(f.price) * 100), online: f.online, in_person: f.in_person,
        group_ok: f.group_ok, city: f.city, lat: f.lat ?? c?.[0] ?? null, lng: f.lng ?? c?.[1] ?? null,
        years_experience: Number(f.years) || 0, education: f.education.trim() || null,
      }, !!existing)
      showToast(existing?.status === 'approved' ? t('lessons.toastTutorSaved') : t('lessons.toastTutorSubmitted'))
      reload()
    } catch (err) { showToast(mapErr(err)) } finally { setBusy(false) }
  }
  const useMyLocation = () => navigator.geolocation?.getCurrentPosition(
    (p) => setF((s) => ({ ...s, lat: p.coords.latitude, lng: p.coords.longitude })), () => showToast(t('lessons.locationDenied')))

  return (
    <div className="ls-section ls-teach">
      {existing && <div className={`ls-banner st-${existing.status}`}><strong>{t(`lessons.tutorStatus.${existing.status}`)}</strong>{existing.rejection_reason && <span>{t('lessons.reason')}: {existing.rejection_reason}</span>}</div>}
      {!existing && <p className="muted">{t('lessons.teachIntro')}</p>}

      <label className="f-label" htmlFor="tf-head">{t('lessons.headline')}</label>
      <input id="tf-head" className="input" maxLength={120} placeholder={t('lessons.headlinePh')} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} />
      <label className="f-label" htmlFor="tf-bio">{t('lessons.bio')} <span className="muted small">({f.bio.trim().length}/30+)</span></label>
      <textarea id="tf-bio" className="input" rows={5} maxLength={2000} placeholder={t('lessons.bioPh')} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />

      <label className="f-label">{t('lessons.whatYouTeach', { count: f.subjects.length })}</label>
      <div className="cat-row ls-cats">
        {LESSON_CATEGORIES.map((c) => {
          const n = c.subjects.filter((s) => f.subjects.includes(s)).length
          return <button key={c.id} type="button" className={`chip ${pickCat === c.id ? 'on' : ''}`} onClick={() => setPickCat(c.id)}>{t(`lessons.categories.${c.id}`)}{n ? ` (${n})` : ''}</button>
        })}
      </div>
      <div className="cat-row wrap">
        {LESSON_CATEGORIES.find((c) => c.id === pickCat).subjects.map((s) => (
          <button key={s} type="button" className={`chip ${f.subjects.includes(s) ? 'on' : ''}`} disabled={!f.subjects.includes(s) && f.subjects.length >= 12} onClick={() => toggle('subjects', s)}>{t(`lessons.subjects.${s}`)}</button>
        ))}
      </div>

      <label className="f-label">{t('lessons.teachLangs')}</label>
      <div className="cat-row wrap">{TEACH_LANGS.map((l) => <button key={l} type="button" className={`chip ${f.teach_langs.includes(l) ? 'on' : ''}`} onClick={() => toggle('teach_langs', l)}>{t(`lessons.langs.${l}`)}</button>)}</div>

      <label className="f-label" htmlFor="tf-price">{t('lessons.pricePerHour')}</label>
      <input id="tf-price" className="input" type="number" min={0} max={200} step={1} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />

      <label className="f-label">{t('lessons.howYouTeach')}</label>
      <label className="toggle-row"><input type="checkbox" checked={f.online} onChange={(e) => setF({ ...f, online: e.target.checked })} /><span>{t('lessons.onlineVideo')}</span></label>
      <label className="toggle-row"><input type="checkbox" checked={f.in_person} onChange={(e) => setF({ ...f, in_person: e.target.checked })} /><span>{t('lessons.inPerson')}</span></label>
      <label className="toggle-row"><input type="checkbox" checked={f.group_ok} onChange={(e) => setF({ ...f, group_ok: e.target.checked })} /><span>{t('lessons.groupOk')}</span></label>

      <label className="f-label" htmlFor="tf-city">{t('lessons.city')}</label>
      <select id="tf-city" className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value, lat: null, lng: null })}>
        {cities.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <button type="button" className="link-btn" onClick={useMyLocation}>{f.lat != null ? t('lessons.locationSet') : t('lessons.useMyLocation')}</button>
      <p className="input-hint">{t('lessons.locationPrivacy')}</p>

      <div className="datetime-row">
        <div><label className="f-label" htmlFor="tf-years">{t('lessons.years')}</label><input id="tf-years" className="input" type="number" min={0} max={60} value={f.years} onChange={(e) => setF({ ...f, years: e.target.value })} /></div>
        <div><label className="f-label" htmlFor="tf-edu">{t('lessons.education')}</label><input id="tf-edu" className="input" maxLength={200} value={f.education} onChange={(e) => setF({ ...f, education: e.target.value })} /></div>
      </div>
      <button type="button" className="btn primary full" disabled={!valid || busy} onClick={save}>
        {busy ? t('lessons.sending') : existing ? t('lessons.saveTutor') : t('lessons.submitTutor')}
      </button>
      <p className="fee-note">{t('lessons.reviewNote')}</p>
    </div>
  )
}

/* ───────────── Video room (Jitsi) ───────────── */
function VideoRoom({ lesson, myName, onClose, mapErr }) {
  const { t } = useI18n()
  const [room, setRoom] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    lessonsApi.room(lesson.id).then(setRoom).catch((e) => setErr(mapErr(e)))
  }, [lesson.id, mapErr])
  const src = useMemo(() => {
    if (!room) return null
    const cfg = [
      `userInfo.displayName=${encodeURIComponent(JSON.stringify(myName || ''))}`,
      'config.prejoinPageEnabled=false',
      'config.disableDeepLinking=true',
      'interfaceConfig.SHOW_JITSI_WATERMARK=false',
    ].join('&')
    return `https://${JITSI_DOMAIN}/${JITSI_ROOM_PREFIX}${room.room}#${cfg}`
  }, [room, myName])
  return (
    <div className="ls-room" role="dialog" aria-modal="true">
      <div className="ls-room-bar">
        <strong>{t(`lessons.subjects.${lesson.subject}`)}</strong>
        <button type="button" className="btn ghost sm" onClick={onClose}>{t('lessons.leaveRoom')}</button>
      </div>
      {err && <p className="ls-room-msg">{err}</p>}
      {!err && !src && <p className="ls-room-msg">{t('lessons.loading')}</p>}
      {src && (
        <iframe
          title={t('lessons.videoTitle')}
          src={src}
          allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
          className="ls-room-frame"
        />
      )}
    </div>
  )
}
