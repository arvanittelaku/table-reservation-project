import { useI18n } from '../i18n/I18nContext'
import type { Locale } from '../i18n/index'

const OPTIONS: Array<{ code: Locale; label: string }> = [
  { code: 'sq', label: 'SQ' },
  { code: 'en', label: 'EN' },
  { code: 'de', label: 'DE' },
  { code: 'mk', label: 'MK' },
]

export default function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className={`lang-switcher ${className}`.trim()} role="group" aria-label={t('appMisc.languageAria')}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.code}
          type="button"
          className={locale === opt.code ? 'active' : ''}
          onClick={() => setLocale(opt.code)}
          aria-pressed={locale === opt.code}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
