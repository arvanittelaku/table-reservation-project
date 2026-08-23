import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'
import { sb } from '../supabaseClient'

const mkIcon = (glyph) => ({ size = 16, className = '' }) => (
  <span className={'emo ' + className} style={{ fontSize: size, lineHeight: 1, display: 'inline-flex' }}>
    {glyph}
  </span>
)
const Shield = mkIcon('◈')
const BarChart3 = mkIcon('▤')
const Flag = mkIcon('⚑')
const Ban = mkIcon('✖')

const REPORT_FILTER_KEYS = ['pending', 'reviewed_banned', 'reviewed_dismissed', 'deleted_immediately']
const RANGE_KEYS = ['day', 'month', 'year']

const DATE_LOCALE = { sq: 'sq-AL', en: 'en-GB', de: 'de-DE', mk: 'mk-MK' }

function formatPeriod(period, locale) {
  if (!period) return '-'
  const d = new Date(period)
  if (Number.isNaN(d.getTime())) return String(period).slice(0, 10)
  const loc = DATE_LOCALE[locale] || locale
  return d.toLocaleDateString(loc, { month: 'short', day: 'numeric', year: '2-digit' })
}

function formatDate(iso, locale) {
  if (!iso) return '-'
  const loc = DATE_LOCALE[locale] || locale
  return new Date(iso).toLocaleString(loc, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function BarChart({ rows, label, emptyText, locale }) {
  const items = Array.isArray(rows) ? rows : []
  const max = Math.max(1, ...items.map((r) => Number(r.count) || 0))
  if (!items.length) {
    return <p className="admin-empty">{emptyText}</p>
  }
  return (
    <div className="admin-chart">
      <p className="admin-chart-label">{label}</p>
      <div className="admin-bars">
        {items.map((row) => (
          <div key={String(row.period)} className="admin-bar-col" title={`${formatPeriod(row.period, locale)}: ${row.count}`}>
            <div
              className="admin-bar"
              style={{ height: `${Math.max(8, (Number(row.count) / max) * 100)}%` }}
            />
            <span className="admin-bar-val">{row.count}</span>
            <span className="admin-bar-lbl">{formatPeriod(row.period, locale)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="admin-stat-card">
      <span className="admin-stat-val">{value ?? '-'}</span>
      <span className="admin-stat-lbl">{label}</span>
    </div>
  )
}

function StatsSkeleton({ loadingLabel }) {
  return (
    <div className="admin-stats-skeleton" aria-busy="true" aria-label={loadingLabel}>
      <div className="admin-stat-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="admin-stat-card admin-skeleton-block" />
        ))}
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="admin-chart admin-skeleton-chart">
          <div className="admin-skeleton-line" />
          <div className="admin-bars">
            {Array.from({ length: 7 }, (_, j) => (
              <div key={j} className="admin-bar-col">
                <div className="admin-bar admin-skeleton-bar" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function AdminPanel({ isAdmin, onViewAsUser, showToast }) {
  const { locale, t } = useI18n()
  const [tab, setTab] = useState('stats')
  const [range, setRange] = useState('month')
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)

  const [reports, setReports] = useState([])
  const [reportFilter, setReportFilter] = useState('pending')
  const [reportsLoading, setReportsLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(null)

  const [bans, setBans] = useState([])
  const [bansLoading, setBansLoading] = useState(false)

  const loadStats = useCallback(async (rangeValue = range) => {
    const { data, error } = await sb.rpc('admin_get_stats', { p_range: rangeValue })
    if (error) throw error
    return data
  }, [range])

  useEffect(() => {
    if (tab !== 'stats') return undefined

    let cancelled = false
    const activeRange = range
    setStatsLoading(true)

    loadStats(activeRange)
      .then((data) => {
        if (cancelled) return
        if (data?.range && data.range !== activeRange) return
        setStats(data)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('admin_get_stats failed:', err)
        showToast(err.message || t('admin.statsLoadFailed'))
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [tab, range, loadStats, showToast, t])

  const loadReports = useCallback(async () => {
    setReportsLoading(true)
    try {
      const { data, error } = await sb.rpc('admin_get_reports', { p_status: reportFilter })
      if (error) throw error
      setReports(data || [])
    } catch (err) {
      console.error('admin_get_reports failed:', err)
      showToast(err.message || t('admin.reportsLoadFailed'))
    } finally {
      setReportsLoading(false)
    }
  }, [reportFilter, showToast, t])

  const loadBans = useCallback(async () => {
    setBansLoading(true)
    try {
      const { data, error } = await sb
        .from('bans')
        .select('id, user_id, reason, created_at, profiles(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      setBans(data || [])
    } catch (err) {
      console.error('bans fetch failed:', err)
      showToast(err.message || t('admin.bansLoadFailed'))
    } finally {
      setBansLoading(false)
    }
  }, [showToast, t])

  useEffect(() => {
    if (tab === 'reports') void loadReports()
  }, [tab, loadReports])

  useEffect(() => {
    if (tab === 'bans') void loadBans()
  }, [tab, loadBans])

  const banGroups = useMemo(() => {
    const map = new Map()
    for (const row of bans) {
      const name = [row.profiles?.first_name, row.profiles?.last_name].filter(Boolean).join(' ') || row.user_id
      const prev = map.get(row.user_id) || { user_id: row.user_id, name, count: 0, latest: row }
      prev.count += 1
      if (new Date(row.created_at) > new Date(prev.latest.created_at)) prev.latest = row
      map.set(row.user_id, prev)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [bans])

  const dismissReport = async (reportId) => {
    setActionBusy(reportId)
    try {
      const { error } = await sb.rpc('admin_dismiss_report', { p_report_id: reportId })
      if (error) throw error
      showToast(t('admin.toastReportDismissed'))
      await loadReports()
      if (tab === 'stats') {
        const data = await loadStats(range)
        setStats(data)
      }
    } catch (err) {
      showToast(err.message || t('admin.toastFailed'))
    } finally {
      setActionBusy(null)
    }
  }

  const banFromReport = async (report) => {
    setActionBusy(report.id)
    try {
      const { data, error } = await sb.rpc('admin_ban_from_report', {
        p_report_id: report.id,
        p_reason: report.reason,
      })
      if (error) throw error
      showToast(t('admin.toastUserBanned', { count: data }))
      await loadReports()
      if (tab === 'stats') {
        const statsData = await loadStats(range)
        setStats(statsData)
      }
    } catch (err) {
      showToast(err.message || t('admin.toastFailed'))
    } finally {
      setActionBusy(null)
    }
  }

  const deleteImmediately = async (report) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return
    setActionBusy(report.id)
    try {
      const { error } = await sb.rpc('admin_delete_immediately', {
        p_report_id: report.id,
        p_reason: report.reason,
      })
      if (error) throw error
      showToast(t('admin.toastAccountDeleted'))
      await loadReports()
      if (tab === 'stats') {
        const statsData = await loadStats(range)
        setStats(statsData)
      }
    } catch (err) {
      showToast(err.message || t('admin.toastFailed'))
    } finally {
      setActionBusy(null)
    }
  }

  const totals = stats?.totals || {}
  const periodLabel = stats?.period_label || t(`admin.rangePeriod.${range}`) || ''
  const statsReady = !!stats && (!stats.range || stats.range === range)
  const showStatsContent = statsReady && !statsLoading
  const showStatsSkeleton = statsLoading && !statsReady

  if (!isAdmin) {
    return <p className="admin-empty">{t('admin.accessDenied')}</p>
  }

  return (
    <div className="admin-panel">
      <header className="admin-hdr">
        <div>
          <h1 className="admin-title"><Shield size={18} /> {t('admin.title')}</h1>
          <p className="meta">{t('admin.subtitle')}</p>
        </div>
      </header>

      {isAdmin && (
        <div className="admin-view-as-user">
          <button type="button" className="btn ghost" onClick={onViewAsUser}>
            {t('admin.viewAsNormalUser')}
          </button>
        </div>
      )}

      <nav className="admin-tabs">
        <button type="button" className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>
          <BarChart3 size={15} /> {t('admin.tabs.stats')}
        </button>
        <button type="button" className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>
          <Flag size={15} /> {t('admin.tabs.reports')}
        </button>
        <button type="button" className={tab === 'bans' ? 'on' : ''} onClick={() => setTab('bans')}>
          <Ban size={15} /> {t('admin.tabs.bans')}
        </button>
      </nav>

      {tab === 'stats' && (
        <div className="admin-body">
          <div className="admin-range">
            {RANGE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={range === key ? 'on' : ''}
                disabled={statsLoading && range === key}
                onClick={() => {
                  if (key !== range) setStats(null)
                  setRange(key)
                }}
              >
                {t(`admin.range.${key}`)}
              </button>
            ))}
          </div>

          {periodLabel && (
            <p className="admin-range-meta muted small">
              {t('admin.statsMeta', { period: periodLabel })}
            </p>
          )}

          {showStatsSkeleton && <StatsSkeleton loadingLabel={t('admin.loadingStats')} />}

          {showStatsContent && (
            <div key={`stats-${range}`} className="admin-stats-content">
              <div className="admin-stat-grid">
                <StatCard label={t('admin.totals.totalUsers')} value={totals.total_users} />
                <StatCard label={t('admin.totals.totalTables')} value={totals.total_tables} />
                <StatCard label={t('admin.totals.activeTables')} value={totals.active_tables_now} />
                <StatCard label={t('admin.totals.memberships')} value={totals.total_memberships} />
                <StatCard label={t('admin.totals.pendingReports')} value={totals.pending_reports} />
                <StatCard label={t('admin.totals.bannedUsers')} value={totals.banned_users_distinct} />
              </div>

              <BarChart
                key={`users-${range}`}
                rows={stats.new_users}
                label={t('admin.charts.newUsers')}
                emptyText={t('admin.chartNoData')}
                locale={locale}
              />
              <BarChart
                key={`tables-${range}`}
                rows={stats.tables_opened}
                label={t('admin.charts.tablesOpened')}
                emptyText={t('admin.chartNoData')}
                locale={locale}
              />
              <BarChart
                key={`memberships-${range}`}
                rows={stats.memberships_joined}
                label={t('admin.charts.memberships')}
                emptyText={t('admin.chartNoData')}
                locale={locale}
              />
            </div>
          )}
        </div>
      )}

      {tab === 'reports' && (
        <div className="admin-body">
          <div className="admin-range">
            {REPORT_FILTER_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={reportFilter === key ? 'on' : ''}
                onClick={() => setReportFilter(key)}
              >
                {t(`admin.reportFilters.${key}`)}
              </button>
            ))}
          </div>

          {reportsLoading && <p className="admin-loading">{t('admin.loadingReports')}</p>}

          {!reportsLoading && reports.length === 0 && (
            <p className="admin-empty">{t('admin.reportsEmpty')}</p>
          )}

          {!reportsLoading && reports.map((r) => {
            const busy = actionBusy === r.id
            return (
              <div key={r.id} className="admin-report-card">
                <div className="admin-report-top">
                  <strong>{r.reporter_name}</strong>
                  <span className="muted">→</span>
                  <strong>{r.reported_name}</strong>
                </div>
                <p className="admin-report-reason">{r.reason}</p>
                {r.table_title && (
                  <p className="muted small">{t('admin.tableLabel')}: {r.table_title}</p>
                )}
                <p className="muted small">{formatDate(r.created_at, locale)}</p>

                {reportFilter === 'pending' && (
                  <div className="admin-report-actions">
                    <button
                      type="button"
                      className="btn primary sm"
                      disabled={busy}
                      onClick={() => void banFromReport(r)}
                    >
                      {t('admin.banBtn')}
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => void dismissReport(r.id)}
                    >
                      {t('admin.dismissBtn')}
                    </button>
                    <button
                      type="button"
                      className="btn safety sm"
                      disabled={busy}
                      onClick={() => void deleteImmediately(r)}
                    >
                      {t('admin.deleteImmediatelyBtn')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'bans' && (
        <div className="admin-body">
          {bansLoading && <p className="admin-loading">{t('admin.loadingBans')}</p>}

          {!bansLoading && banGroups.length === 0 && (
            <p className="admin-empty">{t('admin.bansEmpty')}</p>
          )}

          {!bansLoading && banGroups.map((g) => (
            <div key={g.user_id} className="admin-ban-card">
              <div className="admin-ban-top">
                <strong>{g.name}</strong>
                <span className="badge pending">
                  {g.count === 1
                    ? t('admin.banCountOne', { count: g.count })
                    : t('admin.banCountMany', { count: g.count })}
                </span>
              </div>
              <p className="muted small">{g.latest.reason}</p>
              <p className="muted small">{formatDate(g.latest.created_at, locale)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
