import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { adminApi } from './adminApi'
import { UserLink, useAdmin } from './shared.jsx'
import { Avatar, ConfirmDialog, Empty, ErrorBox, Pill, Segmented, SkeletonRows, fmtDate, fmtMoney, fullName, useLoader } from './ui.jsx'

const STATUSES = ['pending', 'approved', 'rejected', 'suspended', 'all']
const TONE = { pending: 'warn', approved: 'good', rejected: 'bad', suspended: 'bad' }

export default function Tutors() {
  const { t, locale } = useI18n()
  const ctx = useAdmin()
  const [status, setStatus] = useState('pending')
  const [dialog, setDialog] = useState(null) // { action, tutor }
  const { data, error, loading, reload } = useLoader(() => adminApi.listTutors(status), [status, ctx.refreshKey])
  const rows = data || []

  const review = (tutor, next) => async (reason) => {
    try {
      await adminApi.reviewTutor(tutor.user_id, next, reason)
      ctx.toast(t(`adm.tutors.toast.${next}`))
      ctx.bump()
    } catch (err) {
      ctx.toast(err.message)
      throw err
    }
  }

  return (
    <div className="adm-page">
      <div className="adm-page-hdr">
        <div>
          <h1>{t('adm.nav.tutors')}</h1>
          <p className="adm-muted">{t('adm.tutors.subtitle')}</p>
        </div>
      </div>
      <Segmented value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`adm.tutors.status.${s}`), count: s === status && data ? rows.length : undefined }))} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <SkeletonRows rows={3} cols={3} /> : rows.length === 0 ? (
        <div className="adm-card"><Empty>{t('adm.tutors.empty')}</Empty></div>
      ) : (
        <div className={'adm-report-list' + (loading ? ' is-stale' : '')}>
          {rows.map((tu) => (
            <article key={tu.user_id} className="adm-report">
              <header className="adm-report-hdr">
                <span className="adm-person">
                  <Avatar path={tu.photo_path} name={fullName(tu)} size={44} />
                  <span>
                    <UserLink id={tu.user_id} name={`${fullName(tu)}${tu.age ? `, ${tu.age}` : ''}`} />
                    <span className="adm-muted">{tu.email}</span>
                  </span>
                </span>
                <span className="adm-pills">
                  <Pill tone={TONE[tu.status]}>{t(`adm.tutors.status.${tu.status}`)}</Pill>
                  {Number(tu.reports_against) > 0 && <Pill tone="bad">{t('adm.status.reported', { count: tu.reports_against })}</Pill>}
                </span>
              </header>
              <p className="adm-report-reason">{tu.headline}</p>
              <p className="adm-report-details">{tu.bio}</p>
              <div className="adm-pills">
                {(tu.subjects || []).map((s) => <Pill key={s} tone="info">{t(`lessons.subjects.${s}`)}</Pill>)}
              </div>
              <p className="adm-muted">
                {[tu.price_cents ? `${fmtMoney(tu.price_cents, 'EUR', locale)}/h` : t('lessons.free'),
                  [tu.online && t('lessons.online'), tu.in_person && `${t('lessons.inPerson')} · ${tu.city}`].filter(Boolean).join(' + '),
                  tu.group_ok && t('adm.tutors.groups'),
                  t('lessons.yearsExp', { count: tu.years_experience }),
                  tu.education,
                  t('adm.tutors.applied', { date: fmtDate(tu.created_at, locale, false) })].filter(Boolean).join(' · ')}
              </p>
              {tu.rejection_reason && <p className="adm-muted">{t('lessons.reason')}: “{tu.rejection_reason}”{tu.reviewed_by_name ? ` · ${tu.reviewed_by_name}` : ''}</p>}
              <div className="adm-report-actions">
                {tu.status !== 'approved' && <button type="button" className="adm-btn primary" onClick={() => setDialog({ action: 'approved', tutor: tu })}>{t('adm.tutors.approve')}</button>}
                {tu.status === 'pending' && <button type="button" className="adm-btn danger" onClick={() => setDialog({ action: 'rejected', tutor: tu })}>{t('adm.tutors.reject')}</button>}
                {tu.status === 'approved' && <button type="button" className="adm-btn danger" onClick={() => setDialog({ action: 'suspended', tutor: tu })}>{t('adm.tutors.suspend')}</button>}
                <button type="button" className="adm-btn ghost" onClick={() => ctx.openUser(tu.user_id)}>{t('adm.reports.openProfile')}</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!dialog}
        title={dialog ? t(`adm.tutors.confirm.${dialog.action}`, { name: fullName(dialog.tutor) }) : ''}
        body={dialog?.action === 'approved' ? t('adm.tutors.approveBody') : t('adm.tutors.reasonBody')}
        reasonLabel={dialog && dialog.action !== 'approved' ? t('adm.common.reason') : undefined}
        confirmLabel={dialog ? t(`adm.tutors.${dialog.action === 'approved' ? 'approve' : dialog.action === 'rejected' ? 'reject' : 'suspend'}`) : ''}
        danger={dialog?.action !== 'approved'}
        onConfirm={dialog ? review(dialog.tutor, dialog.action) : async () => {}}
        onClose={() => setDialog(null)}
      />
    </div>
  )
}
