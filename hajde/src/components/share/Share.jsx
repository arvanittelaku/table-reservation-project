import { sb } from '../../supabaseClient'
import './share.css'
import { formatEventTime } from '../../lib/formatEventTime'

/* Shareable table links: https://ejabashkohu.com/t/<code>
 * The code survives sign-up, Google/Apple redirects and email confirmation
 * (kept in localStorage for a day), so a friend who opens the link without an
 * account lands on the table right after creating one. */

const CODE_RE = /^\/t\/([A-Za-z0-9-]{6,64})\/?$/
const LS_KEY = 'ejb-pending-share'
const DAY = 864e5

export function parseShareCode(pathname = window.location.pathname) {
  const m = CODE_RE.exec(pathname || '')
  return m ? m[1].toLowerCase() : null
}

export function readPendingShare() {
  const fromUrl = parseShareCode()
  if (fromUrl) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ code: fromUrl, at: Date.now() })) } catch { /* ignore */ }
    return fromUrl
  }
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    if (saved?.code && Date.now() - saved.at < DAY) return saved.code
  } catch { /* ignore */ }
  return null
}

export function clearPendingShare() {
  try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
}

export function shareUrlFor(table) {
  const code = table?.shareCode || table?.share_code || table?.id
  return `${window.location.origin}/t/${code}`
}

export async function fetchSharePreview(code) {
  const { data, error } = await sb.rpc('table_share_preview', { p_code: code })
  if (error) throw error
  return data || null
}

/** Native share sheet on phones (WhatsApp, Instagram, Messenger…), copy elsewhere. */
export async function shareTableLink(table, { t, showToast, formatWhen }) {
  const url = shareUrlFor(table)
  const title = table.cafe || table.title || 'ejaBashkohu'
  const when = formatWhen ? formatWhen(table) : (table.time || '')
  const text = t('share.text', { title, when, city: table.city || '' })
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url })
      return 'shared'
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled' // user closed the sheet
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`)
    showToast?.(t('share.copied'))
    return 'copied'
  } catch {
    window.prompt(t('share.copyPrompt'), url)
    return 'prompted'
  }
}

export function ShareIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  )
}

function fmtWhen(iso, locale) {
  return iso ? formatEventTime(iso, locale) : ''
}

/**
 * Card for an opened link when the full table can't be shown yet:
 * signed out, Basic user + other city, or the table is full/past/closed.
 */
export function SharePreviewCard({ preview, t, locale, onPrimary, onSecondary, onClose }) {
  if (!preview) return null
  const title = preview.secret ? t('share.secretTitle') : preview.title
  const free = Math.max(0, (preview.spots || 0) - (preview.taken || 0))
  const statusText = {
    full: t('share.status.full'), past: t('share.status.past'), closed: t('share.status.closed'),
  }[preview.status]
  let body; let primary; let secondary = null
  if (preview.reason === 'sign_in') {
    body = t('share.signInBody', { host: preview.host_first_name || '' })
    primary = t('share.signUp'); secondary = t('share.haveAccount')
  } else if (preview.reason === 'premium_city') {
    body = t('share.premiumBody', { city: preview.city })
    primary = t('share.seePremium'); secondary = t('share.notNow')
  } else {
    body = statusText || ''
    primary = t('share.close')
  }
  return (
    <div className="share-wrap" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="share-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="share-x" onClick={onClose} aria-label={t('share.close')}>×</button>
        <p className="share-kicker">{t('share.invited')}</p>
        <h2 className="share-title">{title}</h2>
        <p className="share-meta">
          {[preview.area, preview.to_city ? `${preview.city} → ${preview.to_city}` : preview.city].filter(Boolean).join(', ')}
          {preview.event_datetime ? ` · ${fmtWhen(preview.event_datetime, locale)}` : preview.time_label ? ` · ${preview.time_label}` : ''}
        </p>
        <div className="share-seats">
          {preview.status === 'open'
            ? <span className="share-pill ok">{t('share.seatsLeft', { count: free, total: preview.spots })}</span>
            : <span className="share-pill off">{statusText}</span>}
          {preview.women_only && <span className="share-pill">{t('share.womenOnly')}</span>}
          {preview.men_only && <span className="share-pill">{t('share.menOnly')}</span>}
        </div>
        {preview.host_first_name && <p className="share-host">{t('share.hostedBy', { name: preview.host_first_name })}</p>}
        {body && <p className="share-body">{body}</p>}
        <button type="button" className="btn primary full" onClick={onPrimary}>{primary}</button>
        {secondary && <button type="button" className="btn ghost full share-secondary" onClick={onSecondary}>{secondary}</button>}
      </div>
    </div>
  )
}
