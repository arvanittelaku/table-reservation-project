import { useCallback, useEffect, useRef, useState } from 'react'
import { getAvatarUrl } from '../../api/storage'
import { useI18n } from '../../i18n/I18nContext.jsx'

/* ───────────── formatting ───────────── */

const DATE_LOCALE = { sq: 'sq-AL', en: 'en-GB', de: 'de-DE', mk: 'mk-MK' }
export const loc = (locale) => DATE_LOCALE[locale] || locale || 'en-GB'

export function fmtMoney(cents, currency = 'EUR', locale = 'sq') {
  const n = Number(cents || 0) / 100
  try {
    return new Intl.NumberFormat(loc(locale), { style: 'currency', currency, minimumFractionDigits: 2 }).format(n)
  } catch {
    return `€${n.toFixed(2)}`
  }
}

export function fmtNum(n, locale = 'sq') {
  if (n === null || n === undefined) return '–'
  return new Intl.NumberFormat(loc(locale)).format(Number(n))
}

// Browsers ship thin Albanian (sq) locale data ("2026 M10 3", "-40 min"), so sq is formatted by hand.
const SQ_MONTHS = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'korr', 'gush', 'sht', 'tet', 'nën', 'dhj']
const pad2 = (n) => String(n).padStart(2, '0')

export function fmtDate(iso, locale, withTime = true) {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  if (locale === 'sq') {
    const base = `${d.getDate()} ${SQ_MONTHS[d.getMonth()]} ${d.getFullYear()}`
    return withTime ? `${base}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : base
  }
  return d.toLocaleString(loc(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  })
}

const SQ_UNITS = { second: 'sek', minute: 'min', hour: 'orë', day: 'ditë', month: 'muaj', year: 'vit' }

export function fmtRelative(iso, locale) {
  if (!iso) return '–'
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  let value
  let unit
  if (abs < 60) { value = diff; unit = 'second' }
  else if (abs < 3600) { value = diff / 60; unit = 'minute' }
  else if (abs < 86400) { value = diff / 3600; unit = 'hour' }
  else if (abs < 86400 * 30) { value = diff / 86400; unit = 'day' }
  else if (abs < 86400 * 365) { value = diff / (86400 * 30); unit = 'month' }
  else { value = diff / (86400 * 365); unit = 'year' }
  const n = Math.round(value)
  if (locale === 'sq') {
    if (unit === 'second') return 'tani'
    const label = unit === 'year' && Math.abs(n) !== 1 ? 'vjet' : SQ_UNITS[unit]
    return n < 0 ? `para ${Math.abs(n)} ${label}` : `për ${n} ${label}`
  }
  const rtf = new Intl.RelativeTimeFormat(loc(locale), { numeric: 'auto' })
  return unit === 'second' ? rtf.format(0, 'second') : rtf.format(n, unit)
}

export function fmtPeriod(period, range, locale) {
  const d = new Date(period)
  if (Number.isNaN(d.getTime())) return String(period).slice(0, 10)
  if (range === 'year') return String(d.getFullYear())
  if (locale === 'sq') {
    return range === 'month' ? `${SQ_MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : `${d.getDate()} ${SQ_MONTHS[d.getMonth()]}`
  }
  if (range === 'month') return d.toLocaleDateString(loc(locale), { month: 'short', year: '2-digit' })
  return d.toLocaleDateString(loc(locale), { day: 'numeric', month: 'short' })
}

export const fullName = (o) => [o?.first_name, o?.last_name].filter(Boolean).join(' ').trim()

/* ───────────── hooks ───────────── */

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return v
}

/**
 * Runs an async loader whenever deps change; ignores stale responses.
 * Returns { data, error, loading, reload }.
 */
export function useLoader(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const seq = useRef(0)
  const run = useCallback(() => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    loader()
      .then((data) => {
        if (id === seq.current) setState({ data, error: null, loading: false })
      })
      .catch((error) => {
        if (id === seq.current) setState((s) => ({ ...s, error, loading: false }))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    run()
  }, [run])
  return { ...state, reload: run }
}

/* ───────────── CSV ───────────── */

/** Local YYYY-MM-DD for export filenames (toISOString would give the UTC date). */
export function todayStamp() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function downloadCsv(filename, columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.map((c) => esc(c.label)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => esc(c.get(r))).join(','))
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ───────────── icons (inline SVG, 1.75 stroke) ───────────── */

const PATHS = {
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  users: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM3 21a7 7 0 0 1 18 0',
  tables: 'M4 7h16M4 7l2 13h12l2-13M9 7V4h6v3',
  payments: 'M3 6h18v12H3zM3 10h18M7 15h4',
  reports: 'M5 21V4m0 0h11l-2 4 2 4H5',
  bans: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  wednesday: 'M4 4h16v16H4zM4 9h16M9 4v5M15 4v5',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18',
  chevronL: 'M15 6l-6 6 6 6',
  chevronR: 'M9 6l6 6-6 6',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M4 20h16',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  menu: 'M4 6h16M4 12h16M4 18h16',
}

export function Icon({ name, size = 18, className = '' }) {
  return (
    <svg
      className={'adm-ic ' + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] || ''} />
    </svg>
  )
}

/* ───────────── atoms ───────────── */

export function Avatar({ path, name, size = 32 }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (path) getAvatarUrl(path).then((u) => alive && setUrl(u)).catch(() => {})
    return () => {
      alive = false
    }
  }, [path])
  const initials = (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')
  return (
    <span className="adm-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {url ? <img src={url} alt="" loading="lazy" /> : initials || '?'}
    </span>
  )
}

/** tone: neutral | good | warn | bad | info | brand */
export function Pill({ tone = 'neutral', children, title }) {
  return (
    <span className={'adm-pill tone-' + tone} title={title}>
      {children}
    </span>
  )
}

export function Kpi({ label, value, sub, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className={'adm-kpi' + (tone ? ' tone-' + tone : '') + (onClick ? ' is-link' : '')} onClick={onClick}>
      <span className="adm-kpi-label">{label}</span>
      <span className="adm-kpi-value">{value}</span>
      {sub && <span className="adm-kpi-sub">{sub}</span>}
    </Tag>
  )
}

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={'adm-card ' + className}>
      {(title || actions) && (
        <header className="adm-card-hdr">
          {title && <h3>{title}</h3>}
          {actions && <div className="adm-card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'adm-card-body' : ''}>{children}</div>
    </section>
  )
}

export function Empty({ children }) {
  return <div className="adm-empty">{children}</div>
}

export function ErrorBox({ error, onRetry }) {
  const { t } = useI18n()
  if (!error) return null
  return (
    <div className="adm-error" role="alert">
      <div>
        <strong>{t('adm.common.loadFailed')}</strong>
        <p>{error.message}</p>
      </div>
      {onRetry && (
        <button type="button" className="adm-btn" onClick={onRetry}>
          {t('adm.common.retry')}
        </button>
      )}
    </div>
  )
}

export function SkeletonRows({ rows = 6, cols = 5 }) {
  return (
    <div className="adm-skel-rows" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="adm-skel-row">
          {Array.from({ length: cols }, (_, j) => (
            <span key={j} className="adm-skel" style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, autoFocus }) {
  return (
    <label className="adm-search">
      <Icon name="search" size={16} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
    </label>
  )
}

export function Select({ value, onChange, options, label }) {
  return (
    <label className="adm-select">
      {label && <span>{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="adm-seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && o.count !== null && <span className="adm-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Pagination({ total, limit, offset, onChange }) {
  const { t, locale } = useI18n()
  if (!total) return null
  const from = offset + 1
  const to = Math.min(offset + limit, total)
  return (
    <div className="adm-pager">
      <span className="adm-muted">
        {t('adm.common.showing', { from: fmtNum(from, locale), to: fmtNum(to, locale), total: fmtNum(total, locale) })}
      </span>
      <div className="adm-pager-btns">
        <button type="button" className="adm-btn icon" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label={t('adm.common.prev')}>
          <Icon name="chevronL" size={16} />
        </button>
        <button type="button" className="adm-btn icon" disabled={to >= total} onClick={() => onChange(offset + limit)} aria-label={t('adm.common.next')}>
          <Icon name="chevronR" size={16} />
        </button>
      </div>
    </div>
  )
}

/* ───────────── charts (single series → no legend; title names it) ───────────── */

export function ColumnChart({ rows, range, format = (v) => v, height = 160 }) {
  const { locale, t } = useI18n()
  const [hover, setHover] = useState(null)
  const items = Array.isArray(rows) ? rows : []
  if (!items.length) return <Empty>{t('adm.common.noDataPeriod')}</Empty>
  const max = Math.max(1, ...items.map((r) => Number(r.count) || 0))
  const maxIdx = items.findIndex((r) => Number(r.count) === max)
  const lastIdx = items.length - 1
  return (
    <div className="adm-colchart" style={{ height: height + 36 }}>
      <div className="adm-colchart-axis">
        <span>{format(max)}</span>
        <span>{format(0)}</span>
      </div>
      <div className="adm-colchart-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="adm-colchart-grid" />
        {items.map((r, i) => {
          const v = Number(r.count) || 0
          const pct = (v / max) * 100
          const showLabel = i === maxIdx || i === lastIdx
          return (
            <div
              key={String(r.period)}
              className={'adm-col' + (hover === i ? ' is-hover' : '')}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={0}
              aria-label={`${fmtPeriod(r.period, range, locale)}: ${format(v)}`}
            >
              {showLabel && hover === null && <span className="adm-col-val" style={{ bottom: `calc(${pct}% + 4px)` }}>{format(v)}</span>}
              <span className="adm-col-bar" style={{ height: `${Math.max(v ? 2 : 0, pct)}%` }} />
              {hover === i && (
                <span className="adm-tip" role="tooltip" style={{ bottom: `calc(${pct}% + 8px)` }}>
                  <strong>{format(v)}</strong>
                  <span>{fmtPeriod(r.period, range, locale)}</span>
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="adm-colchart-x">
        <span>{fmtPeriod(items[0].period, range, locale)}</span>
        {items.length > 1 && <span>{fmtPeriod(items[lastIdx].period, range, locale)}</span>}
      </div>
    </div>
  )
}

export function BarList({ items, labelKey, valueKey, renderLabel }) {
  const { t, locale } = useI18n()
  if (!items?.length) return <Empty>{t('adm.common.noData')}</Empty>
  const max = Math.max(1, ...items.map((x) => Number(x[valueKey]) || 0))
  return (
    <ul className="adm-barlist">
      {items.map((x) => (
        <li key={String(x[labelKey])}>
          <span className="adm-barlist-lbl">{renderLabel ? renderLabel(x[labelKey]) : x[labelKey]}</span>
          <span className="adm-barlist-track">
            <span className="adm-barlist-fill" style={{ width: `${(Number(x[valueKey]) / max) * 100}%` }} />
          </span>
          <span className="adm-barlist-val">{fmtNum(x[valueKey], locale)}</span>
        </li>
      ))}
    </ul>
  )
}

/* ───────────── overlays ───────────── */

export function Drawer({ open, onClose, title, subtitle, children, actions }) {
  const { t } = useI18n()
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="adm-drawer-wrap" role="dialog" aria-modal="true">
      <div className="adm-drawer-scrim" onClick={onClose} />
      <aside className="adm-drawer">
        <header className="adm-drawer-hdr">
          <div className="adm-drawer-title">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="adm-btn icon ghost" onClick={onClose} aria-label={t('adm.common.close')}>
            <Icon name="close" />
          </button>
        </header>
        {actions && <div className="adm-drawer-actions">{actions}</div>}
        <div className="adm-drawer-body">{children}</div>
      </aside>
    </div>
  )
}

/**
 * Confirmation dialog. With `reasonLabel`, a text field is required before confirming.
 * onConfirm(reason) may return a promise; the dialog stays busy until it settles.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, danger, reasonLabel, reasonPlaceholder, reasonOptional, defaultReason = '', onConfirm, onClose, multiline }) {
  const { t } = useI18n()
  const [reason, setReason] = useState(defaultReason)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setReason(defaultReason)
      setBusy(false)
    }
  }, [open, defaultReason])
  if (!open) return null
  const needsReason = !!reasonLabel && !reasonOptional
  const canConfirm = !busy && (!needsReason || reason.trim().length > 0)
  const submit = async (e) => {
    e?.preventDefault()
    if (!canConfirm) return
    setBusy(true)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch {
      setBusy(false)
    }
  }
  return (
    <div className="adm-modal-wrap" role="dialog" aria-modal="true">
      <div className="adm-drawer-scrim" onClick={busy ? undefined : onClose} />
      <form className="adm-modal" onSubmit={submit}>
        <h3>{title}</h3>
        {body && <p className="adm-muted">{body}</p>}
        {reasonLabel && (
          <label className="adm-field">
            <span>{reasonLabel}</span>
            {multiline ? (
              <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonPlaceholder} maxLength={500} autoFocus />
            ) : (
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonPlaceholder} maxLength={300} autoFocus />
            )}
          </label>
        )}
        <div className="adm-modal-btns">
          <button type="button" className="adm-btn ghost" onClick={onClose} disabled={busy}>
            {t('adm.common.cancel')}
          </button>
          <button type="submit" className={'adm-btn ' + (danger ? 'danger' : 'primary')} disabled={!canConfirm}>
            {busy ? t('adm.common.working') : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

/** Small definition list for detail drawers. */
export function Facts({ items }) {
  return (
    <dl className="adm-facts">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v ?? '–'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CopyId({ id }) {
  const [done, setDone] = useState(false)
  if (!id) return null
  return (
    <button
      type="button"
      className="adm-copyid"
      title={id}
      onClick={() => {
        navigator.clipboard?.writeText(id).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
    >
      {done ? '✓' : String(id).slice(0, 8)}
    </button>
  )
}
