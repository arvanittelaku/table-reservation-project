import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { adminApi } from './adminApi'
import { TableLink, UserLink, useAdmin } from './shared.jsx'
import {
  Avatar, ConfirmDialog, Empty, ErrorBox, Pill, Segmented, SkeletonRows, fmtDate, fmtRelative, useLoader,
} from './ui.jsx'

const REPORT_FILTERS = ['pending', 'reviewed_banned', 'reviewed_dismissed', 'deleted_immediately', 'all']

export function Reports({ params }) {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [filter, setFilter] = useState(params?.status || 'pending')
  const [dialog, setDialog] = useState(null) // { type, report }
  const { data, error, loading, reload } = useLoader(() => adminApi.listReports(filter), [filter, ctx.refreshKey])
  const rows = data || []

  const run = (fn, okMsg) => async (reason) => {
    try {
      const res = await fn(reason)
      ctx.toast(typeof okMsg === 'function' ? okMsg(res) : okMsg)
      ctx.bump()
    } catch (err) {
      ctx.toast(err.message)
      throw err
    }
  }

  const r = dialog?.report
  return (
    <div className="adm-page">
      <div className="adm-page-hdr">
        <div>
          <h1>{t('adm.nav.reports')}</h1>
          <p className="adm-muted">{t('adm.reports.subtitle')}</p>
        </div>
      </div>

      <Segmented value={filter} onChange={setFilter} options={REPORT_FILTERS.map((k) => ({ value: k, label: t(`adm.reports.filter.${k}`), count: k === filter && data ? rows.length : undefined }))} />
      <ErrorBox error={error} onRetry={reload} />

      {loading && !data ? <SkeletonRows rows={4} cols={3} /> : rows.length === 0 ? (
        <div className="adm-card"><Empty>{t('adm.reports.empty')}</Empty></div>
      ) : (
        <div className={'adm-report-list' + (loading ? ' is-stale' : '')}>
          {rows.map((rep) => (
            <article key={rep.id} className="adm-report">
              <header className="adm-report-hdr">
                <div className="adm-report-people">
                  <span className="adm-person">
                    <Avatar path={rep.reporter_photo_path} name={rep.reporter_name} size={30} />
                    <span><span className="adm-muted small">{t('adm.reports.reporter')}</span><UserLink id={rep.reporter_id} name={rep.reporter_name} /></span>
                  </span>
                  <span className="adm-arrow" aria-hidden="true">→</span>
                  <span className="adm-person">
                    <Avatar path={rep.reported_photo_path} name={rep.reported_name} size={30} />
                    <span><span className="adm-muted small">{t('adm.reports.reported')}</span><UserLink id={rep.reported_id} name={rep.reported_name} /></span>
                  </span>
                </div>
                <span className="adm-muted adm-nowrap" title={fmtDate(rep.created_at, locale)}>{fmtRelative(rep.created_at, locale)}</span>
              </header>

              <p className="adm-report-reason">{rep.reason}</p>
              {rep.details && <p className="adm-report-details">{rep.details}</p>}

              <div className="adm-pills">
                {rep.table_id && <Pill tone="neutral">{t('adm.reports.table')}: <TableLink id={rep.table_id} title={rep.table_title} /></Pill>}
                {Number(rep.reported_total_reports) > 1 && <Pill tone="warn">{t('adm.reports.totalAgainst', { count: rep.reported_total_reports })}</Pill>}
                {Number(rep.reported_bans) > 0 && <Pill tone="bad">{t('adm.status.strikes', { count: rep.reported_bans })}</Pill>}
                {rep.status !== 'pending' && (
                  <Pill tone="neutral">{t(`adm.reports.filter.${rep.status}`)}{rep.reviewed_by_name ? ` · ${rep.reviewed_by_name}` : ''}{rep.reviewed_at ? ` · ${fmtDate(rep.reviewed_at, locale, false)}` : ''}</Pill>
                )}
              </div>

              {rep.status === 'pending' && (
                <div className="adm-report-actions">
                  <button type="button" className="adm-btn primary" disabled={rep.reported_is_admin} onClick={() => setDialog({ type: 'ban', report: rep })}>{t('adm.reports.strike')}</button>
                  <button type="button" className="adm-btn" onClick={() => setDialog({ type: 'dismiss', report: rep })}>{t('adm.reports.dismiss')}</button>
                  <button type="button" className="adm-btn danger" disabled={rep.reported_is_admin} onClick={() => setDialog({ type: 'delete', report: rep })}>{t('adm.reports.deleteNow')}</button>
                  <button type="button" className="adm-btn ghost" onClick={() => ctx.openUser(rep.reported_id)}>{t('adm.reports.openProfile')}</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={dialog?.type === 'ban'}
        title={t('adm.userActions.strikeTitle', { name: r?.reported_name || '' })}
        body={t('adm.userActions.strikeBody', { count: Number(r?.reported_bans || 0) + 1 })}
        reasonLabel={t('adm.reports.reasonSentToUser')}
        defaultReason={r?.reason || ''}
        confirmLabel={t('adm.reports.strike')}
        danger
        onConfirm={run((reason) => adminApi.banFromReport(r.id, reason), (n) => t('adm.toast.struckN', { count: n }))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.type === 'dismiss'}
        title={t('adm.reports.dismissTitle')}
        body={t('adm.reports.dismissBody')}
        confirmLabel={t('adm.reports.dismiss')}
        onConfirm={run(() => adminApi.dismissReport(r.id), t('adm.toast.dismissed'))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title={t('adm.userActions.deleteTitle', { name: r?.reported_name || '' })}
        body={t('adm.userActions.deleteBody')}
        reasonLabel={t('adm.common.reason')}
        defaultReason={r?.reason || ''}
        confirmLabel={t('adm.userActions.deleteConfirm')}
        danger
        onConfirm={run((reason) => adminApi.deleteFromReport(r.id, reason), t('adm.toast.deleteQueued'))}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}

export function Bans() {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [open, setOpen] = useState(null)
  const { data, error, loading, reload } = useLoader(() => adminApi.listBans(), [ctx.refreshKey])
  const rows = data || []

  return (
    <div className="adm-page">
      <div className="adm-page-hdr">
        <div>
          <h1>{t('adm.nav.bans')}</h1>
          <p className="adm-muted">{t('adm.bans.subtitle')}</p>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="adm-card adm-table-card">
        {loading && !data ? <SkeletonRows cols={4} /> : rows.length === 0 ? <Empty>{t('adm.bans.empty')}</Empty> : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>{t('adm.users.col.user')}</th>
                <th>{t('adm.bans.col.strikes')}</th>
                <th>{t('adm.bans.col.lastReason')}</th>
                <th>{t('adm.bans.col.last')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <FragmentRow key={b.user_id} b={b} open={open === b.user_id} onToggle={() => setOpen(open === b.user_id ? null : b.user_id)} t={t} locale={locale} ctx={ctx} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function FragmentRow({ b, open, onToggle, t, locale, ctx }) {
  const n = Number(b.ban_count)
  return (
    <>
      <tr className="is-clickable" onClick={onToggle}>
        <td data-label={t('adm.users.col.user')}>
          <span className="adm-person">
            <Avatar path={b.photo_path} name={b.name} size={30} />
            <span>
              {b.name ? <UserLink id={b.user_id} name={b.name} /> : <span className="adm-muted">{t('adm.bans.deletedAccount')}</span>}
              <span className="adm-muted">{b.email || ''}</span>
            </span>
          </span>
        </td>
        <td data-label={t('adm.bans.col.strikes')}>
          <span className="adm-strikes" aria-label={`${n}/3`}>
            {[1, 2, 3].map((i) => <span key={i} className={i <= n ? 'on' : ''} />)}
            <span className="adm-muted">{n}/3</span>
          </span>
        </td>
        <td data-label={t('adm.bans.col.lastReason')}>{b.last_reason}</td>
        <td data-label={t('adm.bans.col.last')} className="adm-nowrap">{fmtDate(b.last_ban_at, locale)}</td>
      </tr>
      {open && (
        <tr className="adm-subrow">
          <td colSpan={4}>
            <ol className="adm-history">
              {(b.history || []).map((h) => (
                <li key={h.id}><strong>{h.reason}</strong> <span className="adm-muted">· {fmtDate(h.created_at, locale)}</span></li>
              ))}
            </ol>
            {b.name && <button type="button" className="adm-btn ghost sm" onClick={() => ctx.openUser(b.user_id)}>{t('adm.reports.openProfile')}</button>}
          </td>
        </tr>
      )}
    </>
  )
}
