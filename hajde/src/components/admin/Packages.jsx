import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { adminApi } from './adminApi'
import { UserLink, useAdmin } from './shared.jsx'
import { Avatar, Card, ConfirmDialog, Empty, ErrorBox, Kpi, Pill, Segmented, SkeletonRows, fmtDate, fmtMoney, fmtNum, useLoader } from './ui.jsx'

export default function Packages() {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [tab, setTab] = useState('orders')
  const [dialog, setDialog] = useState(null)
  const [editing, setEditing] = useState(null)
  const { data, error, loading, reload } = useLoader(() => adminApi.plansOverview(), [ctx.refreshKey])
  const money = (c) => fmtMoney(c, 'EUR', locale)
  const orders = data?.orders || []
  const pending = orders.filter((o) => o.status === 'pending')
  const planName = (id) => t(`adm.packages.planNames.${id}`)

  const run = (fn, ok) => async () => {
    try { await fn(); ctx.toast(ok); ctx.bump() } catch (err) { ctx.toast(err.message); throw err }
  }

  return (
    <div className="adm-page">
      <div className="adm-page-hdr">
        <div>
          <h1>{t('adm.nav.packages')}</h1>
          <p className="adm-muted">{t('adm.packages.subtitle')}</p>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className={'adm-kpis' + (loading && !data ? ' is-loading' : '')}>
        <Kpi label={t('adm.packages.kpi.active')} value={fmtNum(data?.active_premium, locale)} tone="brand" />
        <Kpi label={t('adm.packages.kpi.pending')} value={fmtNum(pending.length, locale)} tone={pending.length ? 'warn' : undefined} onClick={() => setTab('orders')} />
        <Kpi label={t('adm.packages.kpi.revenue30')} value={money(data?.revenue_30d_cents)} sub={t('adm.packages.kpi.total', { total: money(data?.revenue_total_cents) })} />
        <Kpi label={t('adm.packages.kpi.expiring')} value={fmtNum(data?.expiring_7d, locale)} sub={t('adm.packages.kpi.expiringSub')} />
      </div>

      <Segmented value={tab} onChange={setTab} options={[
        { value: 'orders', label: t('adm.packages.tabs.orders'), count: pending.length },
        { value: 'subs', label: t('adm.packages.tabs.subs') },
        { value: 'plans', label: t('adm.packages.tabs.plans') },
      ]} />

      {loading && !data ? <SkeletonRows /> : tab === 'orders' ? (
        orders.length === 0 ? <div className="adm-card"><Empty>{t('adm.packages.noOrders')}</Empty></div> : (
          <div className="adm-card adm-table-card">
            <table className="adm-table">
              <thead><tr><th>{t('adm.users.col.user')}</th><th>{t('adm.packages.col.plan')}</th><th>{t('adm.packages.col.code')}</th><th className="num">{t('adm.payments.col.amount')}</th><th>{t('adm.payments.col.date')}</th><th>{t('adm.payments.col.status')}</th><th /></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td data-label={t('adm.users.col.user')}><span className="adm-person"><Avatar path={o.photo_path} name={o.name} size={30} /><span><UserLink id={o.user_id} name={o.name} /><span className="adm-muted">{o.email}</span></span></span></td>
                    <td data-label={t('adm.packages.col.plan')}>{planName(o.plan_id)}</td>
                    <td data-label={t('adm.packages.col.code')}><code>{o.code}</code></td>
                    <td data-label={t('adm.payments.col.amount')} className="num adm-amount">{money(o.amount_cents)}</td>
                    <td data-label={t('adm.payments.col.date')} className="adm-nowrap">{fmtDate(o.created_at, locale)}</td>
                    <td data-label={t('adm.payments.col.status')}><Pill tone={o.status === 'pending' ? 'warn' : o.status === 'paid' ? 'good' : 'neutral'}>{t(`adm.packages.orderStatus.${o.status}`)}</Pill></td>
                    <td>{o.status === 'pending' && (
                      <span className="adm-pills">
                        <button type="button" className="adm-btn primary sm" onClick={() => setDialog({ type: 'paid', order: o })}>{t('adm.packages.markPaid')}</button>
                        <button type="button" className="adm-btn ghost sm" onClick={() => setDialog({ type: 'cancelOrder', order: o })}>{t('adm.common.cancel')}</button>
                      </span>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'subs' ? (
        (data?.subscriptions || []).length === 0 ? <div className="adm-card"><Empty>{t('adm.packages.noSubs')}</Empty></div> : (
          <div className="adm-card adm-table-card">
            <table className="adm-table">
              <thead><tr><th>{t('adm.users.col.user')}</th><th>{t('adm.packages.col.plan')}</th><th>{t('adm.packages.col.period')}</th><th>{t('adm.packages.col.source')}</th><th className="num">{t('adm.payments.col.amount')}</th><th>{t('adm.payments.col.status')}</th></tr></thead>
              <tbody>
                {data.subscriptions.map((s) => (
                  <tr key={s.id}>
                    <td data-label={t('adm.users.col.user')}><span className="adm-person"><Avatar path={s.photo_path} name={s.name} size={28} /><UserLink id={s.user_id} name={s.name} /></span></td>
                    <td data-label={t('adm.packages.col.plan')}>{planName(s.plan_id)}</td>
                    <td data-label={t('adm.packages.col.period')} className="adm-nowrap">{fmtDate(s.starts_at, locale, false)} → {fmtDate(s.ends_at, locale, false)}</td>
                    <td data-label={t('adm.packages.col.source')}>{t(`adm.packages.source.${s.source}`)}{s.note ? ` · “${s.note}”` : ''}</td>
                    <td data-label={t('adm.payments.col.amount')} className="num">{s.amount_cents ? money(s.amount_cents) : '–'}</td>
                    <td data-label={t('adm.payments.col.status')}><Pill tone={s.status === 'revoked' ? 'bad' : s.current ? 'good' : 'neutral'}>{s.status === 'revoked' ? t('adm.packages.revoked') : s.current ? t('adm.packages.current') : new Date(s.starts_at) > new Date() ? t('adm.packages.upcoming') : t('adm.packages.expired')}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="adm-grid-2">
          {(data?.plans || []).map((p) => (
            <Card key={p.id} title={planName(p.id)} actions={<button type="button" className="adm-btn sm" onClick={() => setEditing({ ...p })}>{t('adm.common.edit')}</button>}>
              {p.tier === 'basic' ? (
                <p>{t('adm.packages.basicRules', { limit: p.monthly_table_limit ?? '∞' })}</p>
              ) : (
                <p><strong className="adm-amount">{money(p.price_cents)}</strong> · {t('adm.packages.perMonthCalc', { price: money(Math.round(p.price_cents / p.months)) })} {!p.active && <Pill tone="bad">{t('adm.packages.hidden')}</Pill>}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={dialog?.type === 'paid'}
        title={t('adm.packages.markPaidTitle', { code: dialog?.order?.code || '' })}
        body={dialog?.order ? t('adm.packages.markPaidBody', { name: dialog.order.name, plan: planName(dialog.order.plan_id), amount: money(dialog.order.amount_cents) }) : ''}
        confirmLabel={t('adm.packages.markPaid')}
        onConfirm={run(() => adminApi.markOrderPaid(dialog.order.id), t('adm.packages.toastActivated'))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.type === 'cancelOrder'}
        title={t('adm.packages.cancelOrderTitle', { code: dialog?.order?.code || '' })}
        confirmLabel={t('adm.packages.cancelOrder')}
        danger
        onConfirm={run(() => adminApi.cancelOrder(dialog.order.id), t('adm.packages.toastCancelled'))}
        onClose={() => setDialog(null)}
      />
      {editing && <PlanEditor plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); ctx.bump() }} />}
    </div>
  )
}

function PlanEditor({ plan, onClose, onSaved }) {
  const { t } = useI18n()
  const ctx = useAdmin()
  const [price, setPrice] = useState((plan.price_cents / 100).toFixed(2))
  const [limit, setLimit] = useState(plan.monthly_table_limit ?? '')
  const [active, setActive] = useState(plan.active)
  const [busy, setBusy] = useState(false)
  const save = async (e) => {
    e.preventDefault(); setBusy(true)
    try {
      await adminApi.updatePlan(plan.id, {
        priceCents: Math.round(Number(price) * 100),
        tableLimit: plan.tier === 'basic' ? (limit === '' ? null : Number(limit)) : null,
        joinLimit: null, active,
      })
      ctx.toast(t('adm.packages.toastSaved')); onSaved()
    } catch (err) { ctx.toast(err.message); setBusy(false) }
  }
  return (
    <div className="adm-modal-wrap" role="dialog" aria-modal="true">
      <div className="adm-drawer-scrim" onClick={busy ? undefined : onClose} />
      <form className="adm-modal" onSubmit={save}>
        <h3>{t(`adm.packages.planNames.${plan.id}`)}</h3>
        {plan.tier === 'basic' ? (
          <label className="adm-field"><span>{t('adm.packages.tableLimit')}</span>
            <input type="number" min={0} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="∞" />
          </label>
        ) : (<>
          <label className="adm-field"><span>{t('adm.packages.price')}</span>
            <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="adm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> <span>{t('adm.packages.visible')}</span>
          </label>
        </>)}
        <p className="adm-muted">{t('adm.packages.editNote')}</p>
        <div className="adm-modal-btns">
          <button type="button" className="adm-btn ghost" onClick={onClose} disabled={busy}>{t('adm.common.cancel')}</button>
          <button type="submit" className="adm-btn primary" disabled={busy}>{busy ? t('adm.common.working') : t('adm.common.save')}</button>
        </div>
      </form>
    </div>
  )
}
