import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { plansApi } from '../../api/plans'
import { fmtDate } from '../../lib/format.js'
import './plans.css'

const euro = (cents) => `€${(cents / 100).toFixed(2)}`
const SUPPORT_NUMBER = String(import.meta.env?.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '')

/** Package comparison + buying flow. */
export function PlansSheet({ plan, onClose, onChanged, onChangeCity, showToast, mapErr, email }) {
  const { t, locale } = useI18n()
  const [busy, setBusy] = useState(null)
  const premiumPlans = (plan?.plans || []).filter((p) => p.tier === 'premium')
  const monthly = premiumPlans.find((p) => p.months === 1)
  const isPremium = plan?.tier === 'premium'
  const order = plan?.pending_order
  const orderPlan = order && premiumPlans.find((p) => p.id === order.plan_id)

  const buy = async (p) => {
    setBusy(p.id)
    try { await plansApi.requestPremium(p.id); await onChanged() } catch (err) { showToast(mapErr(err)) } finally { setBusy(null) }
  }
  const cancel = async () => {
    setBusy('cancel')
    try { await plansApi.cancelOrder(); await onChanged() } catch (err) { showToast(mapErr(err)) } finally { setBusy(null) }
  }
  const waHref = order && SUPPORT_NUMBER
    ? `https://wa.me/${SUPPORT_NUMBER}?text=${encodeURIComponent(t('plans.waMessage', { code: order.code, plan: t(`plans.months.${orderPlan?.months || 1}`), price: euro(order.amount_cents), email: email || '' }))}`
    : null

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet pl-sheet" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pl-close" onClick={onClose} aria-label={t('plans.close')}>×</button>
        <h2>{t('plans.title')}</h2>
        {isPremium && plan?.premium_until && (
          <p className="pl-active">{t('plans.activeUntil', { date: fmtDate(plan.premium_until, locale, false) })}</p>
        )}

        <div className="pl-compare">
          <div className={`pl-tier ${!isPremium ? 'current' : ''}`}>
            <h3>{t('plans.basic')}</h3>
            <p className="pl-price">{t('plans.free')}</p>
            <ul>
              <li>{t('plans.basicCity', { city: plan?.home_city || '—' })}</li>
              <li>{plan?.table_limit != null ? t('plans.basicLimit', { count: plan.table_limit }) : t('plans.unlimitedTables')}</li>
              <li>{t('plans.basicWed')}</li>
              {!isPremium && plan?.table_limit != null && (
                <li className="pl-usage">{t('plans.usage', { used: plan.tables_this_month ?? 0, limit: plan.table_limit })}</li>
              )}
            </ul>
            {!isPremium && <span className="pl-badge">{t('plans.current')}</span>}
            {!isPremium && onChangeCity && <button type="button" className="link-btn" onClick={onChangeCity}>{t('plans.changeCity')}</button>}
          </div>
          <div className={`pl-tier premium ${isPremium ? 'current' : ''}`}>
            <h3>{t('plans.premium')}</h3>
            <p className="pl-price">{t('plans.fromPerMonth', { price: euro(Math.min(...premiumPlans.map((p) => Math.round(p.price_cents / p.months)))) })}</p>
            <ul>
              <li>{t('plans.premiumCities')}</li>
              <li>{t('plans.unlimitedTables')}</li>
              <li>{t('plans.premiumWed')}</li>
              <li>{t('plans.premiumEvents')}</li>
            </ul>
            {isPremium && <span className="pl-badge">{t('plans.current')}</span>}
          </div>
        </div>

        {order ? (
          <div className="pl-order">
            <h3>{t('plans.orderTitle')}</h3>
            <p><strong>{t(`plans.months.${orderPlan?.months || 1}`)}</strong> · {euro(order.amount_cents)}</p>
            <p className="pl-code">{t('plans.orderCode')}: <strong>{order.code}</strong></p>
            <p className="muted small">{t('plans.orderHow')}</p>
            {waHref && <a className="btn primary full pl-wa" href={waHref} target="_blank" rel="noopener noreferrer">{t('plans.payViaWhatsApp')}</a>}
            <button type="button" className="btn ghost full" disabled={busy === 'cancel'} onClick={cancel}>{t('plans.cancelOrder')}</button>
          </div>
        ) : (
          <div className="pl-packs">
            {premiumPlans.map((p) => {
              const perMonth = Math.round(p.price_cents / p.months)
              const save = monthly && p.months > 1 ? Math.round((1 - p.price_cents / (monthly.price_cents * p.months)) * 100) : 0
              return (
                <button key={p.id} type="button" className={`pl-pack ${p.months === 12 ? 'best' : ''}`} disabled={!!busy} onClick={() => buy(p)}>
                  {p.months === 12 && <span className="pl-ribbon">{t('plans.bestValue')}</span>}
                  <span className="pl-pack-name">{t(`plans.months.${p.months}`)}</span>
                  <span className="pl-pack-price">{euro(p.price_cents)}</span>
                  <span className="pl-pack-sub">{t('plans.perMonth', { price: euro(perMonth) })}{save > 0 ? ` · ${t('plans.save', { pct: save })}` : ''}</span>
                  <span className="pl-pack-cta">{busy === p.id ? t('plans.working') : isPremium ? t('plans.extend') : t('plans.choose')}</span>
                </button>
              )
            })}
          </div>
        )}
        <p className="fee-note">{t('plans.note')}</p>
      </div>
    </div>
  )
}

/** Blocking picker shown once to Basic users who have no home city yet. */
export function HomeCityPicker({ cities, initial, onSaved, showToast, mapErr, canClose, onClose }) {
  const { t } = useI18n()
  const [city, setCity] = useState(initial || cities[0])
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { await plansApi.setHomeCity(city); await onSaved(city) } catch (err) { showToast(mapErr(err)); setBusy(false) }
  }
  return (
    <div className="sheet-wrap" onClick={canClose ? onClose : undefined}>
      <div className="sheet pl-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{t('plans.homeCityTitle')}</h2>
        <p className="muted">{t('plans.homeCitySub')}</p>
        <select className="input" value={city} onChange={(e) => setCity(e.target.value)} aria-label={t('plans.homeCityTitle')}>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" className="btn primary full" disabled={busy} onClick={save}>{busy ? t('plans.working') : t('plans.homeCitySave')}</button>
        <p className="fee-note">{t('plans.homeCityNote')}</p>
      </div>
    </div>
  )
}
