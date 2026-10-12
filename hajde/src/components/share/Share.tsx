import { sb } from '../../backendClient'
import './share.css'
import { formatEventTime } from '../../lib/formatEventTime'
import type { TFunction } from '../../i18n/index'
import type { SharePreview } from '../../types/db'

/** What a share link needs from a table (app shape or database row). */
export interface ShareableTable { id: string; shareCode?: string | null; share_code?: string | null; cafe?: string; title?: string; time?: string; city?: string }

/* Shareable table links: https://ejabashkohu.com/t/<code>
 * The code survives sign-up, Google/Apple redirects and email confirmation
 * (kept in localStorage for a day), so a friend who opens the link without an
 * account lands on the table right after creating one. */

const CODE_RE = /^\/t\/([A-Za-z0-9-]{6,64})\/?$/
const LS_KEY = 'ejb-pending-share'
const DAY = 864e5

/** The share code in a path like /t/<code> (the router's location.pathname), or null. */
export function parseShareCode(pathname: string): string | null {
  const m = CODE_RE.exec(pathname || '')
  return m ? m[1].toLowerCase() : null
}

/** Code from the current route (/t/:code), else one remembered from an earlier visit. */
export function readPendingShare(pathname: string): string | null {
  const fromUrl = parseShareCode(pathname)
  if (fromUrl) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ code: fromUrl, at: Date.now() })) } catch { /* ignore */ }
    return fromUrl
  }
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null') as { code?: string; at: number } | null
    if (saved?.code && Date.now() - saved.at < DAY) return saved.code
  } catch { /* ignore */ }
  return null
}

export function clearPendingShare() {
  try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
}

export function shareUrlFor(table: ShareableTable | null | undefined): string {
  const code = table?.shareCode || table?.share_code || table?.id
  return `${window.location.origin}/t/${code}`
}

export async function fetchSharePreview(code: string): Promise<SharePreview | null> {
  const { data, error } = await sb.rpc<SharePreview | null>('table_share_preview', { p_code: code })
  if (error) throw error
  return data || null
}

/** Native share sheet on phones (WhatsApp, Instagram, Messenger…), copy elsewhere. */
export async function shareTableLink(
  table: ShareableTable,
  { t, showToast, formatWhen }: { t: TFunction; showToast?: (msg: string) => void; formatWhen?: (table: ShareableTable) => string },
): Promise<'shared' | 'cancelled' | 'copied' | 'prompted'> {
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
    if (err instanceof Error && err.name === 'AbortError') return 'cancelled' // user closed the sheet
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

export function ShareIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  )
}

function fmtWhen(iso: string | null | undefined, locale: string): string {
  return iso ? formatEventTime(iso, locale) : ''
}

/**
 * Card for an opened link when the full table can't be shown yet:
 * signed out, Basic user + other city, or the table is full/past/closed.
 */
interface SharePreviewCardProps {
  preview: SharePreview | null
  t: TFunction
  locale: string
  onPrimary: () => void
  onSecondary: () => void
  onClose: () => void
}

export function SharePreviewCard({ preview, t, locale, onPrimary, onSecondary, onClose }: SharePreviewCardProps) {
  if (!preview) return null
  const title = preview.secret ? t('share.secretTitle') : preview.title
  const free = Math.max(0, (preview.spots || 0) - (preview.taken || 0))
  const statusText = ({
    full: t('share.status.full'), past: t('share.status.past'), closed: t('share.status.closed'),
  } as Record<string, string | undefined>)[preview.status]
  let body: string; let primary: string; let secondary: string | null = null
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
    <div className="share-wrap" role="dialog" aria-modal="true" aria-label={title ?? undefined} onClick={onClose}>
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
