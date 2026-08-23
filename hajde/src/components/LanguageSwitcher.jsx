import { useI18n } from '../i18n/I18nContext.jsx'

const OPTIONS = [
  { code: 'sq', label: 'SQ' },
  { code: 'en', label: 'EN' },
  { code: 'de', label: 'DE' },
  { code: 'mk', label: 'MK' },
]

export default function LanguageSwitcher({ className = '' }) {
  const { locale, setLocale } = useI18n()

  return (
    <div className={`lang-switcher ${className}`.trim()} role="group" aria-label="Language">
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
