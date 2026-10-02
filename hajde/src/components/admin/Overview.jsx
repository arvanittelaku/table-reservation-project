import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { adminApi } from './adminApi'
import { useAdmin, KindLabel, TableStatusPill } from './shared.jsx'
import {
  Avatar, BarList, Card, ColumnChart, Empty, ErrorBox, Icon, Kpi, Segmented,
  fmtDate, fmtMoney, fmtNum, fmtRelative, fullName, useLoader,
} from './ui.jsx'

export default function Overview() {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [range, setRange] = useState('day')
  const { data, error, loading, reload } = useLoader(() => adminApi.dashboard(range), [range])

  const k = data?.totals || {}
  const s = data?.series || {}
  const n = (v) => fmtNum(v, locale)
  const money = (c) => fmtMoney(c, 'EUR', locale)

  return (
    <div className="adm-page">
      <div className="adm-page-hdr">
        <div>
          <h1>{t('adm.nav.overview')}</h1>
          <p className="adm-muted">
            {data?.generated_at ? t('adm.overview.updated', { time: fmtRelative(data.generated_at, locale) }) : t('adm.overview.subtitle')}
          </p>
        </div>
        <div className="adm-page-actions">
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: 'day', label: t('adm.range.day') },
              { value: 'month', label: t('adm.range.month') },
              { value: 'year', label: t('adm.range.year') },
            ]}
          />
          <button type="button" className="adm-btn icon" onClick={reload} aria-label={t('adm.common.refresh')} disabled={loading}>
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </div>

      <ErrorBox error={error} onRetry={reload} />

      {Number(k.payments_stub) > 0 && (
        <div className="adm-notice">
          <Icon name="shield" size={16} />
          <span>{t('adm.overview.stubNotice', { count: n(k.payments_stub) })}</span>
        </div>
      )}

      <div className={'adm-kpis' + (loading && !data ? ' is-loading' : '')}>
        <Kpi label={t('adm.kpi.users')} value={n(k.users_total)} sub={t('adm.kpi.usersSub', { today: n(k.users_today), week: n(k.users_7d) })} onClick={() => ctx.go('users')} />
        <Kpi label={t('adm.kpi.activeUsers')} value={n(k.users_active_7d)} sub={t('adm.kpi.activeUsersSub')} />
        <Kpi label={t('adm.kpi.upcomingTables')} value={n(k.tables_upcoming)} sub={t('adm.kpi.tablesSub', { total: n(k.tables_total), today: n(k.tables_today) })} onClick={() => ctx.go('tables', { status: 'upcoming' })} />
        <Kpi label={t('adm.kpi.seats')} value={n(k.seats_taken)} sub={t('adm.kpi.seatsSub', { pending: n(k.requests_pending), awaiting: n(k.requests_awaiting_payment) })} />
        <Kpi label={t('adm.kpi.revenue')} value={money(k.revenue_total_cents)} sub={t('adm.kpi.revenueSub', { month: money(k.revenue_30d_cents), today: money(k.revenue_today_cents) })} tone="brand" onClick={() => ctx.go('payments')} />
        <Kpi label={t('adm.kpi.paidSeats')} value={n(k.payments_count)} sub={t('adm.kpi.paidSeatsSub')} onClick={() => ctx.go('payments')} />
        <Kpi label={t('adm.kpi.pendingReports')} value={n(k.reports_pending)} sub={t('adm.kpi.reportsSub', { total: n(k.reports_total) })} tone={Number(k.reports_pending) > 0 ? 'warn' : undefined} onClick={() => ctx.go('reports')} />
        <Kpi label={t('adm.kpi.banned')} value={n(k.banned_users)} sub={t('adm.kpi.bannedSub', { deact: n(k.users_deactivated), unconf: n(k.users_unconfirmed) })} onClick={() => ctx.go('bans')} />
      </div>

      <div className="adm-grid-2">
        <Card title={t('adm.charts.newUsers')}>
          <ColumnChart rows={s.new_users} range={range} format={n} />
        </Card>
        <Card title={t('adm.charts.tablesOpened')}>
          <ColumnChart rows={s.tables_opened} range={range} format={n} />
        </Card>
        <Card title={t('adm.charts.seats')}>
          <ColumnChart rows={s.seats_taken} range={range} format={n} />
        </Card>
        <Card title={t('adm.charts.revenue')}>
          <ColumnChart rows={s.revenue} range={range} format={money} />
        </Card>
      </div>

      <div className="adm-grid-3">
        <Card title={t('adm.overview.byCity')}>
          <BarList items={data?.by_city} labelKey="city" valueKey="tables" />
        </Card>
        <Card title={t('adm.overview.byKind')}>
          <BarList items={data?.by_kind} labelKey="kind" valueKey="tables" renderLabel={(k2) => <KindLabel kind={k2} />} />
        </Card>
        <Card title={t('adm.overview.wednesday')}>
          <div className="adm-mini-kpis">
            <Kpi label={t('adm.kpi.wedGroups')} value={n(k.wednesday_upcoming)} onClick={() => ctx.go('wednesday')} />
            <Kpi label={t('adm.kpi.wedPeople')} value={n(k.wednesday_participants)} />
          </div>
        </Card>
      </div>

      <div className="adm-grid-3">
        <Card title={t('adm.overview.recentUsers')} actions={<button type="button" className="adm-btn ghost sm" onClick={() => ctx.go('users')}>{t('adm.common.viewAll')}</button>}>
          {data?.recent_users?.length ? (
            <ul className="adm-list">
              {data.recent_users.map((u) => (
                <li key={u.id}>
                  <button type="button" className="adm-list-row" onClick={() => ctx.openUser(u.id)}>
                    <Avatar path={u.photo_path} name={fullName(u)} size={30} />
                    <span className="adm-list-main">
                      <strong>{fullName(u)}</strong>
                      <span className="adm-muted">{u.email}</span>
                    </span>
                    <span className="adm-muted adm-nowrap">{fmtRelative(u.created_at, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty>{t('adm.common.noData')}</Empty>}
        </Card>

        <Card title={t('adm.overview.upcomingTables')} actions={<button type="button" className="adm-btn ghost sm" onClick={() => ctx.go('tables', { status: 'upcoming' })}>{t('adm.common.viewAll')}</button>}>
          {data?.upcoming_tables?.length ? (
            <ul className="adm-list">
              {data.upcoming_tables.map((tb) => (
                <li key={tb.id}>
                  <button type="button" className="adm-list-row" onClick={() => ctx.openTable(tb.id)}>
                    <span className="adm-list-main">
                      <strong>{tb.title}</strong>
                      <span className="adm-muted">{tb.city} · {fmtDate(tb.event_datetime, locale)}</span>
                    </span>
                    <span className="adm-seats">{tb.seated}/{tb.spots}</span>
                    <TableStatusPill tbl={tb} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty>{t('adm.overview.noUpcoming')}</Empty>}
        </Card>

        <Card title={t('adm.overview.recentPayments')} actions={<button type="button" className="adm-btn ghost sm" onClick={() => ctx.go('payments')}>{t('adm.common.viewAll')}</button>}>
          {data?.recent_payments?.length ? (
            <ul className="adm-list">
              {data.recent_payments.map((p) => (
                <li key={p.id}>
                  <button type="button" className="adm-list-row" onClick={() => (p.user_id ? ctx.openUser(p.user_id) : ctx.go('payments'))}>
                    <span className="adm-list-main">
                      <strong>{p.payer_name || '–'}</strong>
                      <span className="adm-muted">{p.table_title || '–'} · {p.ticket_code || ''}</span>
                    </span>
                    <span className="adm-amount">{fmtMoney(p.amount_cents, p.currency, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty>{t('adm.payments.empty')}</Empty>}
        </Card>
      </div>
    </div>
  )
}
