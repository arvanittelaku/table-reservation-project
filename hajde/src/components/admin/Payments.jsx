import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { adminApi } from './adminApi'
import { PAGE_SIZE, PaymentStatusPill, TableLink, UserLink, fetchAllPages, useAdmin } from './shared.jsx'
import {
  Empty, ErrorBox, Icon, Kpi, Pagination, SearchInput, Select, SkeletonRows, downloadCsv, todayStamp,
  fmtDate, fmtMoney, fmtNum, useDebounced, useLoader,
} from './ui.jsx'

const STATUSES = ['', 'paid', 'failed', 'void']
const PERIODS = ['all', 'today', '7d', '30d', 'month', 'custom']

function periodRange(period, from, to) {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (period) {
    case 'today': return { from: startOfDay.toISOString(), to: null }
    case '7d': return { from: new Date(now - 7 * 864e5).toISOString(), to: null }
    case '30d': return { from: new Date(now - 30 * 864e5).toISOString(), to: null }
    case 'month': return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: null }
    case 'custom': {
      const f = from ? new Date(from + 'T00:00:00') : null
      const tt = to ? new Date(to + 'T00:00:00') : null
      if (tt) tt.setDate(tt.getDate() + 1) // inclusive end date
      return { from: f ? f.toISOString() : null, to: tt ? tt.toISOString() : null }
    }
    default: return { from: null, to: null }
  }
}

export default function Payments({ params }) {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [search, setSearch] = useState(params?.search || '')
  const [status, setStatus] = useState('')
  const [provider, setProvider] = useState('')
  const [period, setPeriod] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  const q = useDebounced(search, 300)
  // memoized: 'today'/'7d' derive from Date.now(), recomputing each render would refetch forever
  const range = useMemo(() => periodRange(period, from, to), [period, from, to])

  const { data, error, loading, reload } = useLoader(
    () => adminApi.listPayments({ search: q, status, provider, from: range.from, to: range.to, limit: PAGE_SIZE, offset }),
    [q, status, provider, range.from, range.to, offset, ctx.refreshKey],
  )
  const rows = data?.rows || []
  const providers = data?.providers || []
  const setFilter = (fn) => (v) => { fn(v); setOffset(0) }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await fetchAllPages(({ limit, offset: o }) =>
        adminApi.listPayments({ search: q, status, provider, from: range.from, to: range.to, limit, offset: o }))
      downloadCsv(`ejabashkohu-payments-${todayStamp()}.csv`, [
        { label: 'id', get: (r) => r.id },
        { label: 'created_at', get: (r) => r.created_at },
        { label: 'ticket_code', get: (r) => r.ticket_code },
        { label: 'amount_eur', get: (r) => (Number(r.amount_cents) / 100).toFixed(2) },
        { label: 'currency', get: (r) => r.currency },
        { label: 'status', get: (r) => r.status },
        { label: 'provider', get: (r) => r.provider },
        { label: 'provider_ref', get: (r) => r.provider_ref },
        { label: 'payer', get: (r) => r.payer_name },
        { label: 'payer_email', get: (r) => r.payer_email },
        { label: 'user_id', get: (r) => r.user_id },
        { label: 'table', get: (r) => r.table_title },
        { label: 'table_id', get: (r) => r.table_id },
        { label: 'table_city', get: (r) => r.table_city },
        { label: 'host', get: (r) => r.host_name },
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
          <h1>{t('adm.nav.payments')}</h1>
          <p className="adm-muted">{t('adm.payments.subtitle')}</p>
        </div>
        <div className="adm-page-actions">
          <button type="button" className="adm-btn" onClick={exportCsv} disabled={exporting || !data?.total}>
            <Icon name="download" size={16} /> {exporting ? t('adm.common.working') : t('adm.common.exportCsv')}
          </button>
        </div>
      </div>

      {providers.includes('stub') && (
        <div className="adm-notice">
          <Icon name="shield" size={16} />
          <span>{t('adm.payments.stubBanner')}</span>
        </div>
      )}

      <div className="adm-kpis three">
        <Kpi label={t('adm.payments.kpi.revenue')} value={fmtMoney(data?.sum_paid_cents, 'EUR', locale)} sub={t('adm.payments.kpi.filtered')} tone="brand" />
        <Kpi label={t('adm.payments.kpi.paid')} value={fmtNum(data?.count_paid, locale)} sub={t('adm.payments.kpi.filtered')} />
        <Kpi label={t('adm.payments.kpi.all')} value={fmtNum(data?.total, locale)} sub={t('adm.payments.kpi.allSub')} />
      </div>

      <div className="adm-toolbar">
        <SearchInput value={search} onChange={setFilter(setSearch)} placeholder={t('adm.payments.searchPh')} />
        <Select value={period} onChange={setFilter(setPeriod)} label={t('adm.payments.period')} options={PERIODS.map((p) => ({ value: p, label: t(`adm.payments.periods.${p}`) }))} />
        {period === 'custom' && (
          <>
            <label className="adm-select"><span>{t('adm.payments.from')}</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0) }} /></label>
            <label className="adm-select"><span>{t('adm.payments.to')}</span><input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0) }} /></label>
          </>
        )}
        <Select value={status} onChange={setFilter(setStatus)} label={t('adm.payments.col.status')} options={STATUSES.map((s) => ({ value: s, label: s ? t(`adm.paymentStatus.${s}`) : t('adm.common.all') }))} />
        <Select value={provider} onChange={setFilter(setProvider)} label={t('adm.payments.provider')} options={[{ value: '', label: t('adm.common.all') }, ...providers.map((p) => ({ value: p, label: p }))]} />
      </div>

      <ErrorBox error={error} onRetry={reload} />

      <div className="adm-card adm-table-card">
        {loading && !data ? (
          <SkeletonRows cols={6} />
        ) : rows.length === 0 ? (
          <Empty>{t('adm.payments.empty')}</Empty>
        ) : (
          <table className={'adm-table' + (loading ? ' is-stale' : '')}>
            <thead>
              <tr>
                <th>{t('adm.payments.col.date')}</th>
                <th>{t('adm.payments.col.ticket')}</th>
                <th>{t('adm.payments.col.payer')}</th>
                <th>{t('adm.payments.col.table')}</th>
                <th className="num">{t('adm.payments.col.amount')}</th>
                <th>{t('adm.payments.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td data-label={t('adm.payments.col.date')} className="adm-nowrap">{fmtDate(p.created_at, locale)}</td>
                  <td data-label={t('adm.payments.col.ticket')}>
                    <span className="adm-stack"><code>{p.ticket_code || '–'}</code><span className="adm-muted small" title={p.provider_ref}>{p.provider} · {String(p.provider_ref || '').slice(0, 18)}</span></span>
                  </td>
                  <td data-label={t('adm.payments.col.payer')}>
                    <span className="adm-stack"><UserLink id={p.user_id} name={p.payer_name} /><span className="adm-muted">{p.payer_email || (p.user_id ? '' : t('adm.payments.deletedUser'))}</span></span>
                  </td>
                  <td data-label={t('adm.payments.col.table')}>
                    <span className="adm-stack"><TableLink id={p.table_id} title={p.table_title} /><span className="adm-muted">{[p.table_city, p.table_event_datetime && fmtDate(p.table_event_datetime, locale, false)].filter(Boolean).join(' · ')}</span></span>
                  </td>
                  <td data-label={t('adm.payments.col.amount')} className="num adm-amount">{fmtMoney(p.amount_cents, p.currency, locale)}</td>
                  <td data-label={t('adm.payments.col.status')}><PaymentStatusPill status={p.status} provider={p.provider} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination total={data?.total || 0} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
      </div>
    </div>
  )
}
