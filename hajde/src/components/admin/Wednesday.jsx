import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { adminApi } from './adminApi'
import { useAdmin } from './shared.jsx'
import {
  Avatar, Empty, ErrorBox, Icon, Pill, Segmented, SkeletonRows, fmtDate, fmtNum, fmtRelative, fullName, useLoader,
} from './ui.jsx'

export default function Wednesday() {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [tab, setTab] = useState('upcoming')
  const [editing, setEditing] = useState(null) // restaurant object or {} for new
  const [forming, setForming] = useState(false)
  const signupsQ = useLoader(() => adminApi.wednesdaySignups().catch(() => []), [ctx.refreshKey])
  const signups = signupsQ.data || []
  const formNow = async () => {
    if (!window.confirm(t('adm.wed.formBody'))) return
    setForming(true)
    try {
      await adminApi.formWednesday()
      ctx.toast(t('adm.wed.toastFormed'))
      reload(); signupsQ.reload(); ctx.bump()
    } catch (err) { ctx.toast(err.message) } finally { setForming(false) }
  }
  const { data, error, loading, reload } = useLoader(() => adminApi.listWednesday(), [ctx.refreshKey])

  const now = Date.now()
  const groups = data?.groups || []
  const upcoming = groups.filter((g) => new Date(g.dinner_date).getTime() > now).reverse()
  const past = groups.filter((g) => new Date(g.dinner_date).getTime() <= now)
  const restaurants = data?.restaurants || []

  const toggle = async (r) => {
    try {
      await adminApi.setRestaurantActive(r.id, !r.active)
      ctx.toast(r.active ? t('adm.toast.restaurantOff') : t('adm.toast.restaurantOn'))
      reload()
    } catch (err) {
      ctx.toast(err.message)
    }
  }

  const list = tab === 'upcoming' ? upcoming : past

  return (
    <div className="adm-page">
      <div className="adm-page-hdr">
        <div>
          <h1>{t('adm.nav.wednesday')}</h1>
          <p className="adm-muted">{t('adm.wed.subtitle')}</p>
        </div>
        {tab === 'signups' && (
          <div className="adm-page-actions">
            <button type="button" className="adm-btn primary" disabled={forming} onClick={formNow}>{t('adm.wed.formNow')}</button>
          </div>
        )}
        {tab === 'restaurants' && (
          <div className="adm-page-actions">
            <button type="button" className="adm-btn primary" onClick={() => setEditing({})}>{t('adm.wed.addRestaurant')}</button>
          </div>
        )}
      </div>

      <div className="adm-notice subtle">
        <Icon name="eye" size={16} />
        <span>{t('adm.wed.secrecyNote')}</span>
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: t('adm.wed.upcoming'), count: upcoming.length },
          { value: 'past', label: t('adm.wed.past'), count: past.length },
          { value: 'signups', label: t('adm.wed.signups'), count: signups.length },
          { value: 'restaurants', label: t('adm.wed.restaurants'), count: restaurants.length },
        ]}
      />
      <ErrorBox error={error} onRetry={reload} />

      {tab === 'signups' ? (
        signups.length === 0 ? <div className="adm-card"><Empty>{t('adm.wed.noSignups')}</Empty></div> : (
          <div className="adm-card adm-table-wrap">
            <table className="adm-table">
              <tbody>
                {signups.map((s) => (
                  <tr key={s.user_id + s.dinner_date}>
                    <td><Avatar path={s.photo_path} name={fullName(s)} size={28} /> {fullName(s)}{s.age ? `, ${s.age}` : ''}</td>
                    <td>{s.city}</td>
                    <td>{fmtDate(s.dinner_date, locale)}</td>
                    <td>{s.is_premium && <Pill tone="good">Premium</Pill>}</td>
                    <td><Pill tone={s.status === 'grouped' ? 'good' : s.status === 'waitlisted' ? 'warn' : 'info'}>{t(`adm.wed.signupStatus.${s.status}`)}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loading && !data ? <SkeletonRows rows={4} cols={4} /> : tab !== 'restaurants' ? (
        list.length === 0 ? <div className="adm-card"><Empty>{t('adm.wed.noGroups')}</Empty></div> : (
          <div className="adm-wed-grid">
            {list.map((g) => (
              <article key={g.id} className="adm-card adm-wed">
                <header className="adm-wed-hdr">
                  <div>
                    <strong>{fmtDate(g.dinner_date, locale)}</strong>
                    <span className="adm-muted">{g.city} · {fmtRelative(g.dinner_date, locale)}</span>
                  </div>
                  <Pill tone={g.revealed ? 'good' : 'info'}>{g.revealed ? t('adm.wed.revealed') : t('adm.wed.hidden')}</Pill>
                </header>
                <p className="adm-wed-rest">
                  <span className="adm-muted small">{t('adm.wed.restaurant')}</span>
                  <strong>{g.restaurant_name || '–'}</strong>
                  <span className="adm-muted">{g.restaurant_address}</span>
                </p>
                <div>
                  <span className="adm-muted small">{t('adm.wed.participants', { count: (g.participants || []).length })}</span>
                  <ul className="adm-chips">
                    {(g.participants || []).map((p) => (
                      <li key={p.user_id}>
                        <button type="button" className="adm-chip" onClick={() => ctx.openUser(p.user_id)}>
                          <Avatar path={p.photo_path} name={fullName(p)} size={22} />
                          {fullName(p)}{p.age ? `, ${p.age}` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        )
      ) : (
        <div className="adm-card adm-table-card">
          <table className="adm-table">
            <thead>
              <tr>
                <th>{t('adm.wed.col.name')}</th>
                <th>{t('adm.wed.col.city')}</th>
                <th>{t('adm.wed.col.address')}</th>
                <th className="num">{t('adm.wed.col.used')}</th>
                <th>{t('adm.wed.col.active')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {restaurants.map((r) => (
                <tr key={r.id} className={r.active ? '' : 'is-muted'}>
                  <td data-label={t('adm.wed.col.name')}><strong>{r.name}</strong></td>
                  <td data-label={t('adm.wed.col.city')}>{r.city}</td>
                  <td data-label={t('adm.wed.col.address')}>
                    {r.maps_link ? <a className="adm-link" href={r.maps_link} target="_blank" rel="noreferrer">{r.address}</a> : r.address}
                  </td>
                  <td data-label={t('adm.wed.col.used')} className="num">{fmtNum(r.times_used, locale)}</td>
                  <td data-label={t('adm.wed.col.active')}>
                    <button type="button" className={'adm-switch' + (r.active ? ' on' : '')} role="switch" aria-checked={r.active} onClick={() => toggle(r)}>
                      <span />
                    </button>
                  </td>
                  <td><button type="button" className="adm-btn ghost sm" onClick={() => setEditing(r)}>{t('adm.common.edit')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RestaurantForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
    </div>
  )
}

function RestaurantForm({ initial, onClose, onSaved }) {
  const { t } = useI18n()
  const ctx = useAdmin()
  const [f, setF] = useState({
    name: initial.name || '', city: initial.city || '', address: initial.address || '', maps_link: initial.maps_link || '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const valid = f.name.trim().length >= 2 && f.city.trim().length >= 2 && f.address.trim().length >= 2

  const submit = async (e) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      await adminApi.upsertRestaurant({ id: initial.id, ...f })
      ctx.toast(t('adm.toast.restaurantSaved'))
      onSaved()
    } catch (err) {
      ctx.toast(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="adm-modal-wrap" role="dialog" aria-modal="true">
      <div className="adm-drawer-scrim" onClick={busy ? undefined : onClose} />
      <form className="adm-modal" onSubmit={submit}>
        <h3>{initial.id ? t('adm.wed.editRestaurant') : t('adm.wed.addRestaurant')}</h3>
        <label className="adm-field"><span>{t('adm.wed.col.name')}</span><input value={f.name} onChange={set('name')} autoFocus /></label>
        <label className="adm-field"><span>{t('adm.wed.col.city')}</span><input value={f.city} onChange={set('city')} /></label>
        <label className="adm-field"><span>{t('adm.wed.col.address')}</span><input value={f.address} onChange={set('address')} /></label>
        <label className="adm-field"><span>{t('adm.wed.mapsLink')}</span><input value={f.maps_link} onChange={set('maps_link')} placeholder="https://maps.app.goo.gl/…" /></label>
        <div className="adm-modal-btns">
          <button type="button" className="adm-btn ghost" onClick={onClose} disabled={busy}>{t('adm.common.cancel')}</button>
          <button type="submit" className="adm-btn primary" disabled={!valid || busy}>{busy ? t('adm.common.working') : t('adm.common.save')}</button>
        </div>
      </form>
    </div>
  )
}
