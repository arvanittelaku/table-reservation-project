import { createContext, useContext } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { Pill } from './ui.jsx'

/**
 * Shell context: lets any section open the user/table drawers, jump to a section,
 * show a toast, and know who the signed-in admin is.
 */
export const AdminCtx = createContext(null)
export const useAdmin = () => useContext(AdminCtx)

export const PAGE_SIZE = 25

export function UserStatusPills({ u, compact }) {
  const { t } = useI18n()
  const pills = []
  if (u.is_admin) pills.push(<Pill key="adm" tone="brand">{t('adm.status.admin')}</Pill>)
  if (u.deactivated_at) pills.push(<Pill key="deact" tone="bad">{t('adm.status.deactivated')}</Pill>)
  if (!u.email_confirmed_at && u.email_confirmed_at !== undefined) pills.push(<Pill key="unc" tone="warn">{t('adm.status.unconfirmed')}</Pill>)
  if (Number(u.bans_count) > 0) pills.push(<Pill key="ban" tone="bad">{t('adm.status.strikes', { count: u.bans_count })}</Pill>)
  if (Number(u.reports_pending) > 0) pills.push(<Pill key="rep" tone="warn">{t('adm.status.reported', { count: u.reports_pending })}</Pill>)
  if (!pills.length && !compact) pills.push(<Pill key="ok" tone="good">{t('adm.status.active')}</Pill>)
  return <span className="adm-pills">{pills}</span>
}

export function TableStatusPill({ tbl }) {
  const { t } = useI18n()
  if (tbl.status === 'cancelled') return <Pill tone="bad">{t('adm.tableStatus.cancelled')}</Pill>
  if (tbl.is_past || (tbl.event_datetime && new Date(tbl.event_datetime) <= new Date())) {
    return <Pill tone="neutral">{t('adm.tableStatus.past')}</Pill>
  }
  if (tbl.status === 'full' || (tbl.seated !== undefined && Number(tbl.seated) >= Number(tbl.spots))) {
    return <Pill tone="info">{t('adm.tableStatus.full')}</Pill>
  }
  if (tbl.status === 'done') return <Pill tone="neutral">{t('adm.tableStatus.done')}</Pill>
  return <Pill tone="good">{t('adm.tableStatus.open')}</Pill>
}

export function PaymentStatusPill({ status, provider }) {
  const { t } = useI18n()
  const tone = status === 'paid' ? 'good' : status === 'failed' ? 'bad' : 'neutral'
  return (
    <span className="adm-pills">
      <Pill tone={tone}>{t(`adm.paymentStatus.${status}`) || status}</Pill>
      {provider === 'stub' && <Pill tone="warn" title={t('adm.payments.stubHint')}>{t('adm.payments.stub')}</Pill>}
    </span>
  )
}

export function RequestStatusPill({ status }) {
  const { t } = useI18n()
  const tone = { pending: 'warn', approved: 'info', confirmed: 'good', rejected: 'bad', expired: 'neutral' }[status] || 'neutral'
  return <Pill tone={tone}>{t(`adm.requestStatus.${status}`)}</Pill>
}

export function KindLabel({ kind }) {
  const { t } = useI18n()
  return <span className="adm-kind">{t(`adm.kind.${kind}`) || kind}</span>
}

/** Clickable person name that opens the user drawer. */
export function UserLink({ id, name, children }) {
  const ctx = useAdmin()
  if (!id) return <span>{name || children || '–'}</span>
  return (
    <button type="button" className="adm-link" onClick={(e) => { e.stopPropagation(); ctx.openUser(id) }}>
      {children || name || '–'}
    </button>
  )
}

export function TableLink({ id, title }) {
  const ctx = useAdmin()
  if (!id) return <span>{title || '–'}</span>
  return (
    <button type="button" className="adm-link" onClick={(e) => { e.stopPropagation(); ctx.openTable(id) }}>
      {title || '–'}
    </button>
  )
}

/** Fetches all rows of a paginated admin list (for CSV export). */
export async function fetchAllPages(fetchPage, max = 5000) {
  const out = []
  let offset = 0
  for (;;) {
    const res = await fetchPage({ limit: 100, offset })
    const rows = res?.rows || []
    out.push(...rows)
    offset += rows.length
    if (!rows.length || offset >= (res?.total || 0) || offset >= max) break
  }
  return out
}
