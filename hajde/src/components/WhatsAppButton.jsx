import { useI18n } from '../i18n/I18nContext.jsx'

/**
 * Floating "help on WhatsApp" button. Opens a chat with support via wa.me with a
 * pre-filled message in the user's language. The number comes from
 * VITE_SUPPORT_WHATSAPP (international format, digits only, e.g. 38344123456);
 * without it the button is not rendered.
 */
const SUPPORT_NUMBER = String(import.meta.env?.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '')

export default function WhatsAppButton({ email, context, variant = 'app' }) {
  const { t } = useI18n()
  if (!SUPPORT_NUMBER) return null
  const lines = [t('support.message')]
  if (email) lines.push(t('support.account', { email }))
  if (context) lines.push(t('support.page', { page: context }))
  const href = `https://wa.me/${SUPPORT_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`
  return (
    <a className={`wa-btn wa-${variant}`} href={href} target="_blank" rel="noopener noreferrer" aria-label={t('support.aria')} title={t('support.aria')}>
      {/* generic chat bubble; the official WhatsApp logo can be dropped in from their brand kit */}
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z" />
        <path d="M9 9.5c.3 1.9 1.6 3.6 3.5 4.5l1.2-1.1 2.1.9" />
      </svg>
      <span className="wa-label">{t('support.label')}</span>
    </a>
  )
}
