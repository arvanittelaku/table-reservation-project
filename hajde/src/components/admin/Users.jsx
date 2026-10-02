import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { adminApi } from './adminApi'
import {
  PAGE_SIZE, TableLink, UserLink, UserStatusPills, PaymentStatusPill, RequestStatusPill,
  TableStatusPill, KindLabel, fetchAllPages, useAdmin,
} from './shared.jsx'
import {
  Avatar, ConfirmDialog, CopyId, Drawer, Empty, ErrorBox, Facts, Icon, Kpi, Pagination,
  Pill, SearchInput, Segmented, Select, SkeletonRows, downloadCsv, todayStamp, fmtDate, fmtMoney,
  fmtNum, fmtRelative, fullName, useDebounced, useLoader,
} from './ui.jsx'

const STATUSES = ['all', 'active', 'reported', 'banned', 'deactivated', 'unconfirmed', 'paying', 'hosts', 'admin']
const SORTS = ['newest', 'oldest', 'name', 'last_active', 'most_hosted', 'most_joined', 'most_paid', 'most_reported']

export default function Users({ params }) {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [search, setSearch] = useState(params?.search || '')
  const [status, setStatus] = useState(params?.status || 'all')
  const [sort, setSort] = useState('newest')
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  const q = useDebounced(search, 300)

  const { data, error, loading, reload } = useLoader(
    () => adminApi.listUsers({ search: q, status, sort, limit: PAGE_SIZE, offset }),
    [q, status, sort, offset, ctx.refreshKey],
  )
  const rows = data?.rows || []

  const setFilter = (fn) => (v) => { fn(v); setOffset(0) }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await fetchAllPages(({ limit, offset: o }) => adminApi.listUsers({ search: q, status, sort, limit, offset: o }))
      downloadCsv(`ejabashkohu-users-${todayStamp()}.csv`, [
        { label: 'id', get: (r) => r.id },
        { label: 'first_name', get: (r) => r.first_name },
        { label: 'last_name', get: (r) => r.last_name },
        { label: 'email', get: (r) => r.email },
        { label: 'age', get: (r) => r.age },
        { label: 'created_at', get: (r) => r.created_at },
        { label: 'last_sign_in_at', get: (r) => r.last_sign_in_at },
        { label: 'email_confirmed', get: (r) => (r.email_confirmed_at ? 'yes' : 'no') },
        { label: 'is_admin', get: (r) => r.is_admin },
        { label: 'deactivated_at', get: (r) => r.deactivated_at },
        { label: 'tables_hosted', get: (r) => r.hosted_count },
        { label: 'tables_joined', get: (r) => r.joined_count },
        { label: 'payments', get: (r) => r.payments_count },
        { label: 'paid_eur', get: (r) => (Number(r.paid_cents) / 100).toFixed(2) },
        { label: 'strikes', get: (r) => r.bans_count },
        { label: 'reports_against', get: (r) => r.reports_against },
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
          <h1>{t('adm.nav.users')}</h1>
          <p className="adm-muted">{data ? t('adm.users.count', { count: fmtNum(data.total, locale) }) : t('adm.users.subtitle')}</p>
        </div>
        <div className="adm-page-actions">
          <button type="button" className="adm-btn" onClick={exportCsv} disabled={exporting || !data?.total}>
            <Icon name="download" size={16} /> {exporting ? t('adm.common.working') : t('adm.common.exportCsv')}
          </button>
        </div>
      </div>

      <div className="adm-toolbar">
        <SearchInput value={search} onChange={setFilter(setSearch)} placeholder={t('adm.users.searchPh')} />
        <Select value={sort} onChange={setFilter(setSort)} label={t('adm.common.sort')} options={SORTS.map((s) => ({ value: s, label: t(`adm.users.sort.${s}`) }))} />
      </div>
      <Segmented value={status} onChange={setFilter(setStatus)} options={STATUSES.map((s) => ({ value: s, label: t(`adm.users.filter.${s}`) }))} />

      <ErrorBox error={error} onRetry={reload} />

      <div className="adm-card adm-table-card">
        {loading && !data ? (
          <SkeletonRows cols={6} />
        ) : rows.length === 0 ? (
          <Empty>{t('adm.users.empty')}</Empty>
        ) : (
          <table className={'adm-table' + (loading ? ' is-stale' : '')}>
            <thead>
              <tr>
                <th>{t('adm.users.col.user')}</th>
                <th>{t('adm.users.col.status')}</th>
                <th>{t('adm.users.col.joined')}</th>
                <th>{t('adm.users.col.lastActive')}</th>
                <th className="num">{t('adm.users.col.hosted')}</th>
                <th className="num">{t('adm.users.col.tablesJoined')}</th>
                <th className="num">{t('adm.users.col.paid')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="is-clickable" onClick={() => ctx.openUser(u.id)}>
                  <td data-label={t('adm.users.col.user')}>
                    <span className="adm-person">
                      <Avatar path={u.photo_path} name={fullName(u)} size={34} />
                      <span>
                        <strong>{fullName(u) || '–'}</strong>
                        <span className="adm-muted">{u.email || '–'}</span>
                      </span>
                    </span>
                  </td>
                  <td data-label={t('adm.users.col.status')}><UserStatusPills u={u} /></td>
                  <td data-label={t('adm.users.col.joined')} className="adm-nowrap">{fmtDate(u.created_at, locale, false)}</td>
                  <td data-label={t('adm.users.col.lastActive')} className="adm-nowrap">{u.last_sign_in_at ? fmtRelative(u.last_sign_in_at, locale) : t('adm.users.never')}</td>
                  <td data-label={t('adm.users.col.hosted')} className="num">{fmtNum(u.hosted_count, locale)}</td>
                  <td data-label={t('adm.users.col.tablesJoined')} className="num">{fmtNum(u.joined_count, locale)}</td>
                  <td data-label={t('adm.users.col.paid')} className="num">{Number(u.paid_cents) > 0 ? fmtMoney(u.paid_cents, 'EUR', locale) : '–'}</td>
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

/* ═════════════════════════ User detail drawer ═════════════════════════ */

const DETAIL_TABS = ['hosted', 'joined', 'payments', 'requests', 'reports', 'bans', 'history']

export function UserDetail({ id, onClose }) {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [tab, setTab] = useState('joined')
  const [dialog, setDialog] = useState(null)
  const { data, error, loading, reload } = useLoader(() => adminApi.getUser(id), [id])

  const p = data?.profile
  const c = data?.counts || {}
  const name = fullName(p)
  const isSelf = p?.id === ctx.adminId

  const run = (fn, okMsg) => async (reason) => {
    try {
      await fn(reason)
      ctx.toast(okMsg)
      reload()
      ctx.bump()
    } catch (err) {
      ctx.toast(err.message)
      throw err
    }
  }

  const actions = p && !isSelf && (
    <>
      <button type="button" className="adm-btn" onClick={() => setDialog('notify')}>{t('adm.userActions.notify')}</button>
      <button type="button" className="adm-btn" onClick={() => setDialog('ban')} disabled={p.is_admin}>{t('adm.userActions.strike')}</button>
      {p.deactivated_at ? (
        <button type="button" className="adm-btn" onClick={() => setDialog('reactivate')}>{t('adm.userActions.reactivate')}</button>
      ) : (
        <button type="button" className="adm-btn" onClick={() => setDialog('deactivate')}>{t('adm.userActions.deactivate')}</button>
      )}
      <button type="button" className="adm-btn" onClick={() => setDialog(p.is_admin ? 'revokeAdmin' : 'grantAdmin')}>
        {p.is_admin ? t('adm.userActions.revokeAdmin') : t('adm.userActions.grantAdmin')}
      </button>
      <button type="button" className="adm-btn danger" onClick={() => setDialog('delete')} disabled={p.is_admin}>{t('adm.userActions.delete')}</button>
    </>
  )

  const tabCounts = {
    hosted: c.hosted, joined: c.joined, payments: c.payments, requests: c.requests,
    reports: Number(c.reports_against || 0) + Number(c.reports_made || 0), bans: c.bans, history: data?.audit?.length,
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={loading && !p ? t('adm.common.loading') : name || '–'}
      subtitle={p?.email}
      actions={actions}
    >
      <ErrorBox error={error} onRetry={reload} />
      {loading && !p && <SkeletonRows rows={5} cols={2} />}
      {p && (
        <>
          <div className="adm-profile-head">
            <Avatar path={p.photo_path} name={name} size={88} />
            <div>
              <UserStatusPills u={{ ...p, bans_count: c.bans }} />
              {isSelf && <p className="adm-muted small">{t('adm.users.thisIsYou')}</p>}
              {p.photo_path ? null : <p className="adm-muted small">{t('adm.users.noPhoto')}</p>}
            </div>
          </div>

          <Facts
            items={[
              [t('adm.fields.id'), <CopyId key="id" id={p.id} />],
              [t('adm.fields.email'), p.email],
              [t('adm.fields.emailConfirmed'), p.email_confirmed_at ? fmtDate(p.email_confirmed_at, locale) : <Pill tone="warn">{t('adm.common.no')}</Pill>],
              [t('adm.fields.age'), p.age],
              [t('adm.fields.origin'), p.is_tourist ? `${t('adm.fields.tourist')}${p.from_place ? ' · ' + p.from_place : ''}` : t('adm.fields.local')],
              [t('adm.fields.languages'), Array.isArray(p.langs) ? p.langs.join(', ') : '–'],
              [t('adm.fields.registered'), fmtDate(p.created_at, locale)],
              [t('adm.fields.lastSignIn'), p.last_sign_in_at ? `${fmtDate(p.last_sign_in_at, locale)} (${fmtRelative(p.last_sign_in_at, locale)})` : t('adm.users.never')],
              [t('adm.fields.rating'), Number(p.rating).toFixed(2)],
              p.deactivated_at && [t('adm.fields.deactivatedAt'), fmtDate(p.deactivated_at, locale)],
            ]}
          />

          <div className="adm-mini-kpis">
            <Kpi label={t('adm.users.kpi.paid')} value={fmtMoney(c.paid_cents, 'EUR', locale)} sub={t('adm.users.kpi.paidSub', { count: fmtNum(c.payments, locale) })} />
            <Kpi label={t('adm.users.kpi.messages')} value={fmtNum(c.messages, locale)} />
            <Kpi label={t('adm.users.kpi.connections')} value={fmtNum(c.connections, locale)} />
            <Kpi label={t('adm.users.kpi.blockedBy')} value={fmtNum(c.blocked_by, locale)} tone={Number(c.blocked_by) > 0 ? 'warn' : undefined} sub={t('adm.users.kpi.blocking', { count: fmtNum(c.blocking, locale) })} />
          </div>

          <Segmented value={tab} onChange={setTab} options={DETAIL_TABS.map((k) => ({ value: k, label: t(`adm.users.tabs.${k}`), count: tabCounts[k] ?? 0 }))} />

          <div className="adm-drawer-section">
            {tab === 'hosted' && (data.hosted_tables.length ? (
              <ul className="adm-list">
                {data.hosted_tables.map((tb) => (
                  <li key={tb.id}>
                    <button type="button" className="adm-list-row" onClick={() => ctx.openTable(tb.id)}>
                      <span className="adm-list-main">
                        <strong>{tb.title}</strong>
                        <span className="adm-muted"><KindLabel kind={tb.kind} /> · {tb.city} · {fmtDate(tb.event_datetime, locale)}</span>
                      </span>
                      <span className="adm-seats">{t('adm.tables.guestsN', { count: tb.guests })}</span>
                      <TableStatusPill tbl={tb} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <Empty>{t('adm.users.noneHosted')}</Empty>)}

            {tab === 'joined' && (data.joined_tables.length ? (
              <ul className="adm-list">
                {data.joined_tables.map((tb) => (
                  <li key={tb.id}>
                    <button type="button" className="adm-list-row" onClick={() => ctx.openTable(tb.id)}>
                      <span className="adm-list-main">
                        <strong>{tb.title}</strong>
                        <span className="adm-muted">{t('adm.tables.hostBy', { name: tb.host_name || '–' })} · {fmtDate(tb.event_datetime, locale)}</span>
                      </span>
                      {tb.payment_status ? (
                        <span className="adm-pay-cell">
                          <span className="adm-amount">{fmtMoney(tb.amount_cents, 'EUR', locale)}</span>
                          <span className="adm-muted">{tb.ticket_code}</span>
                        </span>
                      ) : (
                        <Pill tone="neutral">{tb.kind === 'vozitje' ? t('adm.tables.freeRide') : t('adm.tables.noPayment')}</Pill>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <Empty>{t('adm.users.noneJoined')}</Empty>)}

            {tab === 'payments' && (data.payments.length ? (
              <table className="adm-table compact">
                <thead><tr><th>{t('adm.payments.col.date')}</th><th>{t('adm.payments.col.table')}</th><th>{t('adm.payments.col.ticket')}</th><th className="num">{t('adm.payments.col.amount')}</th><th>{t('adm.payments.col.status')}</th></tr></thead>
                <tbody>
                  {data.payments.map((py) => (
                    <tr key={py.id}>
                      <td data-label={t('adm.payments.col.date')} className="adm-nowrap">{fmtDate(py.created_at, locale)}</td>
                      <td data-label={t('adm.payments.col.table')}><TableLink id={py.table_id} title={py.table_title} /></td>
                      <td data-label={t('adm.payments.col.ticket')}><code>{py.ticket_code || '–'}</code></td>
                      <td data-label={t('adm.payments.col.amount')} className="num">{fmtMoney(py.amount_cents, py.currency, locale)}</td>
                      <td data-label={t('adm.payments.col.status')}><PaymentStatusPill status={py.status} provider={py.provider} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>{t('adm.payments.emptyUser')}</Empty>)}

            {tab === 'requests' && (data.requests.length ? (
              <ul className="adm-list">
                {data.requests.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="adm-list-row" onClick={() => ctx.openTable(r.table_id)}>
                      <span className="adm-list-main">
                        <strong>{r.table_title}</strong>
                        <span className="adm-muted">{fmtDate(r.created_at, locale)}</span>
                      </span>
                      <RequestStatusPill status={r.status} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <Empty>{t('adm.users.noneRequests')}</Empty>)}

            {tab === 'reports' && (
              <>
                <h4 className="adm-subhead">{t('adm.users.reportsAgainst')}</h4>
                {data.reports_against.length ? (
                  <ul className="adm-list">
                    {data.reports_against.map((r) => (
                      <li key={r.id} className="adm-list-static">
                        <span className="adm-list-main">
                          <strong>{r.reason}</strong>
                          {r.details && <span>{r.details}</span>}
                          <span className="adm-muted">
                            {t('adm.reports.by')} <UserLink id={r.reporter_id} name={r.reporter_name} /> · {fmtDate(r.created_at, locale)}
                            {r.table_title ? ` · ${r.table_title}` : ''}
                          </span>
                        </span>
                        <Pill tone={r.status === 'pending' ? 'warn' : 'neutral'}>{t(`adm.reports.filter.${r.status}`)}</Pill>
                      </li>
                    ))}
                  </ul>
                ) : <Empty>{t('adm.users.noReportsAgainst')}</Empty>}
                <h4 className="adm-subhead">{t('adm.users.reportsMade')}</h4>
                {data.reports_made.length ? (
                  <ul className="adm-list">
                    {data.reports_made.map((r) => (
                      <li key={r.id} className="adm-list-static">
                        <span className="adm-list-main">
                          <strong>{r.reason}</strong>
                          <span className="adm-muted">→ <UserLink id={r.reported_id} name={r.reported_name} /> · {fmtDate(r.created_at, locale)}</span>
                        </span>
                        <Pill tone="neutral">{t(`adm.reports.filter.${r.status}`)}</Pill>
                      </li>
                    ))}
                  </ul>
                ) : <Empty>{t('adm.users.noReportsMade')}</Empty>}
              </>
            )}

            {tab === 'bans' && (data.bans.length ? (
              <ul className="adm-list">
                {data.bans.map((b, i) => (
                  <li key={b.id} className="adm-list-static">
                    <span className="adm-list-main">
                      <strong>{t('adm.bans.strikeN', { n: data.bans.length - i })}: {b.reason}</strong>
                      <span className="adm-muted">{fmtDate(b.created_at, locale)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty>{t('adm.users.noBans')}</Empty>)}

            {tab === 'history' && (data.audit.length ? (
              <ul className="adm-list">
                {data.audit.map((a) => (
                  <li key={a.id} className="adm-list-static">
                    <span className="adm-list-main">
                      <strong>{t(`adm.audit.actions.${a.action}`) || a.action}</strong>
                      <span className="adm-muted">{a.admin_name || '–'} · {fmtDate(a.created_at, locale)}{a.details?.reason ? ` · “${a.details.reason}”` : ''}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty>{t('adm.users.noHistory')}</Empty>)}
          </div>
        </>
      )}

      <ConfirmDialog
        open={dialog === 'notify'}
        title={t('adm.userActions.notifyTitle', { name })}
        body={t('adm.userActions.notifyBody')}
        reasonLabel={t('adm.userActions.message')}
        multiline
        confirmLabel={t('adm.userActions.send')}
        onConfirm={run((msg) => adminApi.notifyUser(id, msg), t('adm.toast.notified'))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'ban'}
        title={t('adm.userActions.strikeTitle', { name })}
        body={t('adm.userActions.strikeBody', { count: Number(c.bans || 0) + 1 })}
        reasonLabel={t('adm.common.reason')}
        reasonPlaceholder={t('adm.userActions.reasonPh')}
        confirmLabel={t('adm.userActions.strike')}
        danger
        onConfirm={run((reason) => adminApi.banUser(id, reason), t('adm.toast.struck'))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'deactivate'}
        title={t('adm.userActions.deactivateTitle', { name })}
        body={t('adm.userActions.deactivateBody')}
        reasonLabel={t('adm.common.reasonOptional')}
        reasonOptional
        confirmLabel={t('adm.userActions.deactivate')}
        danger
        onConfirm={run((reason) => adminApi.setDeactivated(id, true, reason), t('adm.toast.deactivated'))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'reactivate'}
        title={t('adm.userActions.reactivateTitle', { name })}
        body={t('adm.userActions.reactivateBody')}
        confirmLabel={t('adm.userActions.reactivate')}
        onConfirm={run(() => adminApi.setDeactivated(id, false), t('adm.toast.reactivated'))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'grantAdmin'}
        title={t('adm.userActions.grantTitle', { name })}
        body={t('adm.userActions.grantBody')}
        confirmLabel={t('adm.userActions.grantAdmin')}
        danger
        onConfirm={run(() => adminApi.setAdmin(id, true), t('adm.toast.adminGranted'))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'revokeAdmin'}
        title={t('adm.userActions.revokeTitle', { name })}
        confirmLabel={t('adm.userActions.revokeAdmin')}
        onConfirm={run(() => adminApi.setAdmin(id, false), t('adm.toast.adminRevoked'))}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title={t('adm.userActions.deleteTitle', { name })}
        body={t('adm.userActions.deleteBody')}
        reasonLabel={t('adm.common.reason')}
        confirmLabel={t('adm.userActions.deleteConfirm')}
        danger
        onConfirm={run((reason) => adminApi.deleteUser(id, reason), t('adm.toast.deleteQueued'))}
        onClose={() => setDialog(null)}
      />
    </Drawer>
  )
}
