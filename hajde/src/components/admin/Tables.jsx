import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { adminApi } from './adminApi'
import {
  KindLabel, PAGE_SIZE, PaymentStatusPill, RequestStatusPill, TableStatusPill, UserLink,
  fetchAllPages, useAdmin,
} from './shared.jsx'
import {
  Avatar, ConfirmDialog, CopyId, Drawer, Empty, ErrorBox, Facts, Icon, Kpi, Pagination, Pill,
  SearchInput, Segmented, Select, SkeletonRows, downloadCsv, todayStamp, fmtDate, fmtMoney, fmtNum,
  fmtRelative, fullName, useDebounced, useLoader,
} from './ui.jsx'

const STATUSES = ['all', 'upcoming', 'past', 'full', 'cancelled', 'paid', 'reported']
const KINDS = ['', 'tavoline', 'vozitje', 'udhetim', 'darka_e_merkures']
const SORTS = ['newest', 'oldest', 'event_asc', 'event_desc', 'most_guests', 'most_revenue', 'most_requests']

export default function Tables({ params }) {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [search, setSearch] = useState(params?.search || '')
  const [status, setStatus] = useState(params?.status || 'all')
  const [kind, setKind] = useState('')
  const [city, setCity] = useState('')
  const [sort, setSort] = useState(params?.status === 'upcoming' ? 'event_asc' : 'newest')
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  const q = useDebounced(search, 300)

  const { data, error, loading, reload } = useLoader(
    () => adminApi.listTables({ search: q, status, kind, city, sort, limit: PAGE_SIZE, offset }),
    [q, status, kind, city, sort, offset, ctx.refreshKey],
  )
  const rows = data?.rows || []
  const cities = (data?.cities || []).slice().sort((a, b) => String(a).localeCompare(String(b)))
  const setFilter = (fn) => (v) => { fn(v); setOffset(0) }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await fetchAllPages(({ limit, offset: o }) =>
        adminApi.listTables({ search: q, status, kind, city, sort, limit, offset: o }))
      downloadCsv(`ejabashkohu-tables-${todayStamp()}.csv`, [
        { label: 'id', get: (r) => r.id },
        { label: 'title', get: (r) => r.title },
        { label: 'kind', get: (r) => r.kind },
        { label: 'category', get: (r) => r.category },
        { label: 'city', get: (r) => r.city },
        { label: 'event_datetime', get: (r) => r.event_datetime },
        { label: 'status', get: (r) => r.status },
        { label: 'host', get: (r) => r.host_name },
        { label: 'host_id', get: (r) => r.host_id },
        { label: 'spots', get: (r) => r.spots },
        { label: 'guests', get: (r) => r.guests },
        { label: 'pending_requests', get: (r) => r.pending_requests },
        { label: 'awaiting_payment', get: (r) => r.awaiting_payment },
        { label: 'paid_seats', get: (r) => r.paid_count },
        { label: 'revenue_eur', get: (r) => (Number(r.revenue_cents) / 100).toFixed(2) },
        { label: 'messages', get: (r) => r.messages_count },
        { label: 'reports', get: (r) => r.reports_count },
        { label: 'created_at', get: (r) => r.created_at },
      ], all)
    } catch (err) {
      ctx.toast(err.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="adm-page">
      <div className="adm-page-hdr">
        <div>
          <h1>{t('adm.nav.tables')}</h1>
          <p className="adm-muted">{data ? t('adm.tables.count', { count: fmtNum(data.total, locale) }) : t('adm.tables.subtitle')}</p>
        </div>
        <div className="adm-page-actions">
          <button type="button" className="adm-btn" onClick={exportCsv} disabled={exporting || !data?.total}>
            <Icon name="download" size={16} /> {exporting ? t('adm.common.working') : t('adm.common.exportCsv')}
          </button>
        </div>
      </div>

      <div className="adm-toolbar">
        <SearchInput value={search} onChange={setFilter(setSearch)} placeholder={t('adm.tables.searchPh')} />
        <Select value={kind} onChange={setFilter(setKind)} label={t('adm.tables.kindLabel')} options={KINDS.map((k) => ({ value: k, label: k ? t(`adm.kind.${k}`) : t('adm.common.all') }))} />
        <Select value={city} onChange={setFilter(setCity)} label={t('adm.tables.cityLabel')} options={[{ value: '', label: t('adm.common.all') }, ...cities.map((c) => ({ value: c, label: c }))]} />
        <Select value={sort} onChange={setFilter(setSort)} label={t('adm.common.sort')} options={SORTS.map((s) => ({ value: s, label: t(`adm.tables.sort.${s}`) }))} />
      </div>
      <Segmented value={status} onChange={setFilter(setStatus)} options={STATUSES.map((s) => ({ value: s, label: t(`adm.tables.filter.${s}`) }))} />

      <ErrorBox error={error} onRetry={reload} />

      <div className="adm-card adm-table-card">
        {loading && !data ? (
          <SkeletonRows cols={6} />
        ) : rows.length === 0 ? (
          <Empty>{t('adm.tables.empty')}</Empty>
        ) : (
          <table className={'adm-table' + (loading ? ' is-stale' : '')}>
            <thead>
              <tr>
                <th>{t('adm.tables.col.table')}</th>
                <th>{t('adm.tables.col.host')}</th>
                <th>{t('adm.tables.col.when')}</th>
                <th>{t('adm.tables.col.seats')}</th>
                <th className="num">{t('adm.tables.col.requests')}</th>
                <th className="num">{t('adm.tables.col.paid')}</th>
                <th>{t('adm.tables.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tb) => {
                const pct = Math.min(100, (Number(tb.seated) / Math.max(1, Number(tb.spots))) * 100)
                return (
                  <tr key={tb.id} className="is-clickable" onClick={() => ctx.openTable(tb.id)}>
                    <td data-label={t('adm.tables.col.table')}>
                      <span className="adm-stack">
                        <strong>{tb.title}</strong>
                        <span className="adm-muted"><KindLabel kind={tb.kind} /> · {tb.city}{tb.to_city ? ` → ${tb.to_city}` : ''}</span>
                      </span>
                    </td>
                    <td data-label={t('adm.tables.col.host')}><UserLink id={tb.host_id} name={tb.host_name} /></td>
                    <td data-label={t('adm.tables.col.when')} className="adm-nowrap">
                      <span className="adm-stack">
                        <span>{fmtDate(tb.event_datetime, locale)}</span>
                        <span className="adm-muted">{fmtRelative(tb.event_datetime, locale)}</span>
                      </span>
                    </td>
                    <td data-label={t('adm.tables.col.seats')}>
                      <span className="adm-meter" title={`${tb.seated}/${tb.spots}`}>
                        <span className="adm-meter-track"><span className="adm-meter-fill" style={{ width: `${pct}%` }} /></span>
                        <span className="adm-meter-val">{tb.seated}/{tb.spots}</span>
                      </span>
                    </td>
                    <td data-label={t('adm.tables.col.requests')} className="num">
                      {Number(tb.pending_requests) > 0 ? <Pill tone="warn">{tb.pending_requests}</Pill> : '0'}
                      {Number(tb.awaiting_payment) > 0 && <span className="adm-muted small"> +{tb.awaiting_payment} {t('adm.tables.awaitingShort')}</span>}
                    </td>
                    <td data-label={t('adm.tables.col.paid')} className="num">
                      {Number(tb.paid_count) > 0 ? (
                        <span className="adm-stack num">
                          <span>{fmtMoney(tb.revenue_cents, 'EUR', locale)}</span>
                          <span className="adm-muted">{t('adm.tables.paidSeatsN', { count: tb.paid_count })}</span>
                        </span>
                      ) : '–'}
                    </td>
                    <td data-label={t('adm.tables.col.status')}>
                      <span className="adm-pills">
                        <TableStatusPill tbl={tb} />
                        {Number(tb.reports_count) > 0 && <Pill tone="bad">{t('adm.tables.reportsN', { count: tb.reports_count })}</Pill>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <Pagination total={data?.total || 0} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
      </div>
    </div>
  )
}

/* ═════════════════════════ Table detail drawer ═════════════════════════ */

export function TableDetail({ id, onClose }) {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [dialog, setDialog] = useState(null)
  const { data, error, loading, reload } = useLoader(() => adminApi.getTable(id), [id])
  const tb = data?.table
  const members = data?.members || []
  const guests = members.filter((m) => m.role === 'member')
  const host = members.find((m) => m.role === 'host')
  const paidGuests = guests.filter((m) => m.payment_status === 'paid')
  const revenue = (data?.payments || []).filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount_cents || 0), 0)
  const isRide = tb?.kind === 'vozitje'
  const restrict = tb?.women_only ? t('adm.tables.womenOnly') : tb?.men_only ? t('adm.tables.menOnly') : t('adm.tables.everyone')

  const run = (fn, okMsg) => async (reason) => {
    try {
      const res = await fn(reason)
      ctx.toast(typeof okMsg === 'function' ? okMsg(res) : okMsg)
      reload()
      ctx.bump()
    } catch (err) {
      ctx.toast(err.message)
      throw err
    }
  }

  const actions = tb && (
    <>
      {tb.maps_link && (
        <a className="adm-btn" href={tb.maps_link} target="_blank" rel="noreferrer">
          <Icon name="external" size={15} /> {t('adm.tables.openMap')}
        </a>
      )}
      {tb.status === 'cancelled' ? (
        <button type="button" className="adm-btn" onClick={() => setDialog('restore')} disabled={tb.is_past}>{t('adm.tables.restore')}</button>
      ) : (
        <button type="button" className="adm-btn danger" onClick={() => setDialog('cancel')}>{t('adm.tables.cancel')}</button>
      )}
    </>
  )

  return (
    <Drawer open onClose={onClose} title={tb?.title || t('adm.common.loading')} subtitle={tb ? `${t(`adm.kind.${tb.kind}`)} · ${tb.city}` : ''} actions={actions}>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !tb && <SkeletonRows rows={5} cols={2} />}
      {tb && (
        <>
          <div className="adm-pills adm-mb">
            <TableStatusPill tbl={{ ...tb, seated: members.length }} />
            {tb.mystery && <Pill tone="info">{t('adm.tables.mystery')}</Pill>}
            {(tb.women_only || tb.men_only) && <Pill tone="info">{restrict}</Pill>}
          </div>

          <div className="adm-mini-kpis">
            <Kpi label={t('adm.tables.kpi.seats')} value={`${members.length}/${tb.spots}`} sub={t('adm.tables.kpi.seatsSub', { guests: guests.length })} />
            <Kpi label={t('adm.tables.kpi.paid')} value={isRide ? t('adm.tables.freeRide') : `${paidGuests.length}/${guests.length}`} sub={isRide ? '' : fmtMoney(revenue, 'EUR', locale)} tone={!isRide && guests.length > paidGuests.length ? 'warn' : undefined} />
            <Kpi label={t('adm.tables.kpi.requests')} value={fmtNum((data.requests || []).filter((r) => r.status === 'pending').length, locale)} sub={t('adm.tables.kpi.waitlist', { count: (data.waitlist || []).length })} />
            <Kpi label={t('adm.tables.kpi.chat')} value={fmtNum(data.chat?.messages, locale)} sub={data.chat?.last_message_at ? fmtRelative(data.chat.last_message_at, locale) : ''} />
          </div>

          <Facts
            items={[
              [t('adm.fields.id'), <CopyId key="id" id={tb.id} />],
              [t('adm.tables.col.host'), <UserLink key="h" id={tb.host_id} name={tb.host_name} />],
              [t('adm.fields.hostEmail'), tb.host_email],
              [t('adm.tables.col.when'), `${fmtDate(tb.event_datetime, locale)} (${fmtRelative(tb.event_datetime, locale)})`],
              [t('adm.fields.timeLabel'), tb.time_label],
              [t('adm.fields.category'), tb.category],
              [t('adm.fields.place'), [tb.area, tb.city, tb.to_city && `→ ${tb.to_city}`].filter(Boolean).join(' · ')],
              tb.budget && [t('adm.fields.budget'), tb.budget],
              [t('adm.fields.audience'), restrict],
              [t('adm.fields.languages'), Array.isArray(tb.langs) ? tb.langs.join(', ') : '–'],
              [t('adm.fields.created'), fmtDate(tb.created_at, locale)],
            ]}
          />
          {tb.description && <p className="adm-desc">{tb.description}</p>}

          <h4 className="adm-subhead">{t('adm.tables.members')} ({members.length})</h4>
          {members.length ? (
            <table className="adm-table compact">
              <thead><tr><th>{t('adm.users.col.user')}</th><th>{t('adm.tables.role')}</th><th>{t('adm.tables.joinedAt')}</th><th>{t('adm.tables.payment')}</th></tr></thead>
              <tbody>
                {[host, ...guests].filter(Boolean).map((m) => (
                  <tr key={m.user_id} className="is-clickable" onClick={() => ctx.openUser(m.user_id)}>
                    <td data-label={t('adm.users.col.user')}>
                      <span className="adm-person">
                        <Avatar path={m.photo_path} name={fullName(m)} size={28} />
                        <span><strong>{fullName(m)}</strong><span className="adm-muted">{m.email}</span></span>
                      </span>
                    </td>
                    <td data-label={t('adm.tables.role')}>{m.role === 'host' ? <Pill tone="brand">{t('adm.tables.host')}</Pill> : t('adm.tables.guest')}</td>
                    <td data-label={t('adm.tables.joinedAt')} className="adm-nowrap">{fmtDate(m.joined_at, locale)}</td>
                    <td data-label={t('adm.tables.payment')}>
                      {m.role === 'host' ? '–' : m.payment_status ? (
                        <span className="adm-pay-cell">
                          <PaymentStatusPill status={m.payment_status} provider={m.provider} />
                          <span className="adm-muted">{fmtMoney(m.amount_cents, 'EUR', locale)} · {m.ticket_code}</span>
                        </span>
                      ) : isRide ? <Pill tone="neutral">{t('adm.tables.freeRide')}</Pill> : <Pill tone="warn">{t('adm.tables.noPayment')}</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>{t('adm.tables.noMembers')}</Empty>}

          <h4 className="adm-subhead">{t('adm.tables.requests')} ({(data.requests || []).length})</h4>
          {data.requests?.length ? (
            <ul className="adm-list">
              {data.requests.map((r) => (
                <li key={r.id}>
                  <button type="button" className="adm-list-row" onClick={() => ctx.openUser(r.user_id)}>
                    <Avatar path={r.photo_path} name={fullName(r)} size={28} />
                    <span className="adm-list-main">
                      <strong>{fullName(r)}{r.age ? `, ${r.age}` : ''}</strong>
                      <span className="adm-muted">{fmtDate(r.created_at, locale)}</span>
                    </span>
                    <RequestStatusPill status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty>{t('adm.tables.noRequests')}</Empty>}

          {data.waitlist?.length > 0 && (
            <>
              <h4 className="adm-subhead">{t('adm.tables.waitlist')} ({data.waitlist.length})</h4>
              <ul className="adm-list">
                {data.waitlist.map((w, i) => (
                  <li key={w.user_id} className="adm-list-static">
                    <span className="adm-list-main"><strong>{i + 1}. <UserLink id={w.user_id} name={fullName(w)} /></strong><span className="adm-muted">{fmtDate(w.created_at, locale)}</span></span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {data.payments?.length > 0 && (
            <>
              <h4 className="adm-subhead">{t('adm.tables.paymentsTitle')} ({data.payments.length})</h4>
              <table className="adm-table compact">
                <thead><tr><th>{t('adm.payments.col.date')}</th><th>{t('adm.payments.col.payer')}</th><th>{t('adm.payments.col.ticket')}</th><th className="num">{t('adm.payments.col.amount')}</th><th>{t('adm.payments.col.status')}</th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td data-label={t('adm.payments.col.date')} className="adm-nowrap">{fmtDate(p.created_at, locale)}</td>
                      <td data-label={t('adm.payments.col.payer')}><UserLink id={p.user_id} name={p.payer_name} /></td>
                      <td data-label={t('adm.payments.col.ticket')}><code>{p.ticket_code || '–'}</code></td>
                      <td data-label={t('adm.payments.col.amount')} className="num">{fmtMoney(p.amount_cents, p.currency, locale)}</td>
                      <td data-label={t('adm.payments.col.status')}><PaymentStatusPill status={p.status} provider={p.provider} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {data.reports?.length > 0 && (
            <>
              <h4 className="adm-subhead">{t('adm.nav.reports')} ({data.reports.length})</h4>
              <ul className="adm-list">
                {data.reports.map((r) => (
                  <li key={r.id} className="adm-list-static">
                    <span className="adm-list-main">
                      <strong>{r.reason}</strong>
                      <span className="adm-muted">{r.reporter_name} → <UserLink id={r.reported_id} name={r.reported_name} /> · {fmtDate(r.created_at, locale)}</span>
                    </span>
                    <Pill tone={r.status === 'pending' ? 'warn' : 'neutral'}>{t(`adm.reports.filter.${r.status}`)}</Pill>
                  </li>
                ))}
              </ul>
            </>
          )}

          {data.audit?.length > 0 && (
            <>
              <h4 className="adm-subhead">{t('adm.users.tabs.history')}</h4>
              <ul className="adm-list">
                {data.audit.map((a) => (
                  <li key={a.id} className="adm-list-static">
                    <span className="adm-list-main">
                      <strong>{t(`adm.audit.actions.${a.action}`)}</strong>
                      <span className="adm-muted">{a.admin_name} · {fmtDate(a.created_at, locale)}{a.details?.reason ? ` · “${a.details.reason}”` : ''}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={dialog === 'cancel'}
        title={t('adm.tables.cancelTitle', { title: tb?.title || '' })}
        body={t('adm.tables.cancelBody', { count: members.length + (data?.requests || []).filter((r) => ['pending', 'approved'].includes(r.status)).length })}
        reasonLabel={t('adm.tables.cancelReason')}
        reasonPlaceholder={t('adm.tables.cancelReasonPh')}
        confirmLabel={t('adm.tables.cancel')}
        danger
        onConfirm={run((reason) => adminApi.cancelTable(id, reason), (n) => t('adm.toast.tableCancelled', { count: n }))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'restore'}
        title={t('adm.tables.restoreTitle')}
        body={t('adm.tables.restoreBody')}
        confirmLabel={t('adm.tables.restore')}
        onConfirm={run(() => adminApi.restoreTable(id), t('adm.toast.tableRestored'))}
        onClose={() => setDialog(null)}
      />
    </Drawer>
  )
}
