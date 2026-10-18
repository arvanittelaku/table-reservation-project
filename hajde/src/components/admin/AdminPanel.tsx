import { getSessionUser } from '../../lib/session'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import { sb } from '../../backendClient'
import LanguageSwitcher from '../LanguageSwitcher'
import { adminApi } from './adminApi'
import { AdminCtx, useAdmin, type AdminContextValue, type AdminSection, type SectionParams, type SectionProps } from './shared'
import type { DashboardTotals, GlobalSearch as GlobalSearchResult } from './adminTypes'
import type { Uuid } from '../../types/db'
import { Avatar, Icon, fmtMoney, fullName, useDebounced } from './ui'
import Overview from './Overview'
import Users, { UserDetail } from './Users'
import Tables, { TableDetail } from './Tables'
import Payments from './Payments'
import { Bans, Reports } from './Moderation'
import Wednesday from './Wednesday'
import Activity from './Activity'
import Tutors from './Tutors'
import Packages from './Packages'
import './admin.css'

type BadgeKey = 'orders_pending' | 'reports_pending' | 'tutors_pending'
interface SectionDef { key: AdminSection; icon: string; Comp: ComponentType<SectionProps>; badge?: BadgeKey }
type Counts = DashboardTotals & { tutors_pending: number; orders_pending: number }

const SECTIONS: SectionDef[] = [
  { key: 'overview', icon: 'overview', Comp: Overview },
  { key: 'users', icon: 'users', Comp: Users },
  { key: 'tables', icon: 'tables', Comp: Tables },
  { key: 'payments', icon: 'payments', Comp: Payments },
  { key: 'packages', icon: 'packages', Comp: Packages, badge: 'orders_pending' },
  { key: 'reports', icon: 'reports', Comp: Reports, badge: 'reports_pending' },
  { key: 'bans', icon: 'bans', Comp: Bans },
  { key: 'tutors', icon: 'tutors', Comp: Tutors, badge: 'tutors_pending' },
  { key: 'wednesday', icon: 'wednesday', Comp: Wednesday },
  { key: 'activity', icon: 'activity', Comp: Activity },
]
const SECTION_KEY = 'ejabashkohu-admin-section'

function readSection(): AdminSection {
  try {
    const s = sessionStorage.getItem(SECTION_KEY)
    return SECTIONS.find((x) => x.key === s)?.key ?? 'overview'
  } catch {
    return 'overview'
  }
}

export interface AdminPanelProps {
  isAdmin: boolean
  onViewAsUser: () => void
  onSignOut?: () => void
  adminId?: Uuid | null
}

interface Me { id: Uuid; first_name?: string; last_name?: string; photo_path?: string | null; email: string | null }

export default function AdminPanel({ isAdmin, onViewAsUser, onSignOut, adminId: adminIdProp }: AdminPanelProps) {
  const { t } = useI18n()
  const [nav, setNav] = useState<{ section: AdminSection; params: SectionParams | null; key: number }>(() => ({ section: readSection(), params: null, key: 0 }))
  const [drawer, setDrawer] = useState<{ type: 'user' | 'table'; id: Uuid } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const adminId = adminIdProp || me?.id || undefined

  useEffect(() => {
    let alive = true
    getSessionUser().then(async ({ data }) => {
      const user = data?.user
      const uid = user?.id
      if (!user || !uid || !alive) return
      const { data: prof } = await sb.from('profiles').select('id, first_name, last_name, photo_path').eq('id', uid).maybeSingle()
      if (alive) setMe({ ...(prof || { id: uid }), email: user.email ?? null })
    })
    return () => { alive = false }
  }, [])

  // Sidebar badges (pending reports etc.) — refreshed after every admin action.
  useEffect(() => {
    let alive = true
    adminApi.dashboard('day')
      .then(async (d) => {
        // pending teacher applications (lessons migration; ignore if not applied yet)
        // optional sections: their migrations may not be applied yet
        const [pending, orders] = await Promise.all([
          adminApi.listTutors('pending').then((r) => (r || []).length).catch(() => 0),
          adminApi.plansOverview().then((r) => (r?.orders || []).filter((o) => o.status === 'pending').length).catch(() => 0),
        ])
        if (alive) { setCounts({ ...d.totals, tutors_pending: pending, orders_pending: orders }) }
      })
      .catch(() => { /* the counters are optional; each page shows its own load error */ })
    return () => { alive = false }
  }, [refreshKey])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 3200)
  }, [])

  const go = useCallback((section: AdminSection, params: SectionParams | null = null) => {
    setNav((n) => ({ section, params, key: n.key + 1 }))
    setMenuOpen(false)
    try { sessionStorage.setItem(SECTION_KEY, section) } catch { /* ignore */ }
    window.scrollTo?.({ top: 0 })
  }, [])

  const ctx = useMemo((): AdminContextValue => ({
    adminId,
    refreshKey,
    toast,
    go,
    bump: () => setRefreshKey((k) => k + 1),
    openUser: (id: Uuid) => setDrawer({ type: 'user', id }),
    openTable: (id: Uuid) => setDrawer({ type: 'table', id }),
  }), [adminId, refreshKey, toast, go])

  if (!isAdmin) return <p className="adm-empty">{t('admin.accessDenied')}</p>

  const current = SECTIONS.find((s) => s.key === nav.section) || SECTIONS[0]
  const Comp = current.Comp

  return (
    <AdminCtx.Provider value={ctx}>
      <div className={'adm' + (menuOpen ? ' menu-open' : '')}>
        <aside className="adm-side">
          <div className="adm-brand">
            <span className="adm-logo">eja<span>Bashkohu</span></span>
            <span className="adm-brand-tag">{t('adm.brandTag')}</span>
          </div>
          <nav className="adm-nav">
            {SECTIONS.map((s) => {
              const badge = s.badge && counts ? Number(counts[s.badge]) : 0
              return (
                <button key={s.key} type="button" className={nav.section === s.key ? 'on' : ''} onClick={() => go(s.key)} aria-current={nav.section === s.key ? 'page' : undefined}>
                  <Icon name={s.icon} size={18} />
                  <span>{t(`adm.nav.${s.key}`)}</span>
                  {badge > 0 && <span className="adm-nav-badge">{badge}</span>}
                </button>
              )
            })}
          </nav>
          <div className="adm-side-foot">
            {counts && (
              <div className="adm-side-stat">
                <span>{t('adm.side.revenue')}</span>
                <strong>{fmtMoney(counts.revenue_total_cents)}</strong>
              </div>
            )}
            <LanguageSwitcher className="adm-lang" />
            <button type="button" className="adm-side-btn" onClick={onViewAsUser}>
              <Icon name="eye" size={16} /> {t('adm.side.viewAsUser')}
            </button>
            {me && (
              <div className="adm-me">
                <Avatar path={me.photo_path} name={fullName(me)} size={30} />
                <span className="adm-me-txt">
                  <strong>{fullName(me) || 'Admin'}</strong>
                  <span>{me.email}</span>
                </span>
                {onSignOut && (
                  <button type="button" className="adm-side-link" onClick={onSignOut}>{t('adm.side.signOut')}</button>
                )}
              </div>
            )}
          </div>
        </aside>
        <div className="adm-scrim-nav" onClick={() => setMenuOpen(false)} />

        <div className="adm-main">
          <header className="adm-top">
            <button type="button" className="adm-btn icon ghost adm-menu-btn" onClick={() => setMenuOpen(true)} aria-label={t('adm.common.menu')}>
              <Icon name="menu" />
            </button>
            <GlobalSearch />
            <span className="adm-top-title">{t(`adm.nav.${current.key}`)}</span>
          </header>


          <main className="adm-content">
            <Comp key={nav.key} params={nav.params} />
          </main>
        </div>

        {drawer?.type === 'user' && <UserDetail key={'u' + drawer.id} id={drawer.id} onClose={() => setDrawer(null)} />}
        {drawer?.type === 'table' && <TableDetail key={'t' + drawer.id} id={drawer.id} onClose={() => setDrawer(null)} />}

        {toastMsg && <div className="adm-toast" role="status">{toastMsg}</div>}
      </div>
    </AdminCtx.Provider>
  )
}

function GlobalSearch() {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [res, setRes] = useState<GlobalSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const dq = useDebounced(q, 250)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const ctx = useAdmin()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement | null)?.tagName || '').toLowerCase()
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    const onClick = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [])

  useEffect(() => {
    let alive = true
    if (dq.trim().length < 2) { setRes(null); return undefined }
    setLoading(true)
    adminApi.search(dq.trim())
      .then((r) => { if (alive) setRes(r) })
      .catch(() => { if (alive) setRes(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [dq])

  const pick = (fn: () => void) => { fn(); setOpen(false); setQ('') }
  const empty = res && !res.users?.length && !res.tables?.length && !res.payments?.length

  return (
    <div className="adm-gsearch" ref={boxRef}>
      <label className="adm-search">
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="search"
          value={q}
          placeholder={t('adm.search.placeholder')}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), e.currentTarget.blur())}
          aria-label={t('adm.search.placeholder')}
        />
        <kbd>/</kbd>
      </label>
      {open && q.trim().length >= 2 && (
        <div className="adm-gsearch-pop">
          {loading && !res && <p className="adm-muted pad">{t('adm.common.loading')}</p>}
          {empty && <p className="adm-muted pad">{t('adm.search.none')}</p>}
          {res && res.users.length > 0 && (
            <div className="adm-gs-group">
              <h5>{t('adm.nav.users')}</h5>
              {res.users.map((u) => (
                <button key={u.id} type="button" onClick={() => pick(() => ctx.openUser(u.id))}>
                  <Avatar path={u.photo_path} name={fullName(u)} size={24} />
                  <span><strong>{fullName(u)}</strong><span className="adm-muted">{u.email}</span></span>
                </button>
              ))}
            </div>
          )}
          {res && res.tables.length > 0 && (
            <div className="adm-gs-group">
              <h5>{t('adm.nav.tables')}</h5>
              {res.tables.map((tb) => (
                <button key={tb.id} type="button" onClick={() => pick(() => ctx.openTable(tb.id))}>
                  <Icon name="tables" size={16} />
                  <span><strong>{tb.title}</strong><span className="adm-muted">{tb.city}</span></span>
                </button>
              ))}
            </div>
          )}
          {res && res.payments.length > 0 && (
            <div className="adm-gs-group">
              <h5>{t('adm.nav.payments')}</h5>
              {res.payments.map((p) => (
                <button key={p.id} type="button" onClick={() => pick(() => ctx.go('payments', { search: p.ticket_code || p.id }))}>
                  <Icon name="payments" size={16} />
                  <span><strong>{p.ticket_code || p.id.slice(0, 8)}</strong><span className="adm-muted">{p.payer_name} · {fmtMoney(p.amount_cents)}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

