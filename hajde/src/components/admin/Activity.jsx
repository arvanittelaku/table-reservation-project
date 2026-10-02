import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { adminApi } from './adminApi'
import { useAdmin } from './shared.jsx'
import { Empty, ErrorBox, Pagination, SkeletonRows, fmtDate, fmtRelative, useLoader } from './ui.jsx'

const LIMIT = 50

export default function Activity() {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [offset, setOffset] = useState(0)
  const { data, error, loading, reload } = useLoader(() => adminApi.listAudit({ limit: LIMIT, offset }), [offset, ctx.refreshKey])
  const rows = data?.rows || []

  const target = (a) => {
    const label = a.target_label || String(a.target_id || '').slice(0, 8) || '–'
    if (a.action === 'user_deleted') return <span>{label}</span>
    if (a.target_type === 'user' && a.target_id) return <button type="button" className="adm-link" onClick={() => ctx.openUser(a.target_id)}>{label}</button>
    if (a.target_type === 'table' && a.target_id) return <button type="button" className="adm-link" onClick={() => ctx.openTable(a.target_id)}>{label}</button>
    return <span>{label}</span>
  }

  const detail = (a) => {
    const d = a.details || {}
    const parts = []
    if (d.reason) parts.push(`“${d.reason}”`)
    if (d.message) parts.push(`“${d.message}”`)
    if (d.ban_count) parts.push(`${d.ban_count}/3`)
    if (d.notified !== undefined) parts.push(t('adm.audit.notified', { count: d.notified }))
    if (d.email) parts.push(d.email)
    return parts.join(' · ')
  }

  return (
    <div className="adm-page">
      <div className="adm-page-hdr">
        <div>
          <h1>{t('adm.nav.activity')}</h1>
          <p className="adm-muted">{t('adm.audit.subtitle')}</p>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="adm-card adm-table-card">
        {loading && !data ? <SkeletonRows cols={4} /> : rows.length === 0 ? <Empty>{t('adm.audit.empty')}</Empty> : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>{t('adm.audit.col.when')}</th>
                <th>{t('adm.audit.col.admin')}</th>
                <th>{t('adm.audit.col.action')}</th>
                <th>{t('adm.audit.col.target')}</th>
                <th>{t('adm.audit.col.details')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td data-label={t('adm.audit.col.when')} className="adm-nowrap" title={fmtDate(a.created_at, locale)}>{fmtRelative(a.created_at, locale)}</td>
                  <td data-label={t('adm.audit.col.admin')}>{a.admin_name || '–'}</td>
                  <td data-label={t('adm.audit.col.action')}><span className={'adm-action act-' + a.action}>{t(`adm.audit.actions.${a.action}`)}</span></td>
                  <td data-label={t('adm.audit.col.target')}>{target(a)}</td>
                  <td data-label={t('adm.audit.col.details')} className="adm-muted">{detail(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination total={data?.total || 0} limit={LIMIT} offset={offset} onChange={setOffset} />
      </div>
    </div>
  )
}
